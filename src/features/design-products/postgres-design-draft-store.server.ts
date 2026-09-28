import "server-only"

import { createHash, randomBytes, randomUUID } from "node:crypto"

import type { Pool, PoolClient } from "pg"
import type { LibraryStoredAsset } from "@/features/design-library/library-types"

import type {
  DesignDraftInput,
  DesignDraftRecipe,
  DesignDraftResult,
  DesignProductPayload,
  FrozenDesignSelection,
} from "./design-draft-types"

import { DesignDraftError } from "./design-draft-error"
import { mapPrivateArtworkAsset } from "./map-private-artwork-asset"
import { productArtworkFingerprint } from "./product-artwork-fingerprint"

type Row = Record<string, unknown>
export type DesignDraftOperation = {
  bindingId: string
  requestId: string
  userId: string
  /** Null when a signed-in administrator, rather than an agent grant, is doing the work. */
  grantId: string | null
  stage: string
  leaseId: string | null
  uploadedImageId: string | null
  productPayload: DesignProductPayload | null
  observedProductId: string | null
  knownProductIds: string[]
  recipe: DesignDraftRecipe
  title: string
  selection: FrozenDesignSelection
}

export class PostgresDesignDraftStore {
  constructor(
    readonly database: Pool,
    readonly userId: string,
    readonly grantId: string | null,
    readonly shopId: string
  ) {}
  private async transaction<T>(work: (client: PoolClient) => Promise<T>, checkAdmin = true) {
    const client = await this.database.connect()
    try {
      await client.query("begin")
      await client.query("set local statement_timeout='5s'; set local lock_timeout='3s'")
      if (
        checkAdmin &&
        !(
          await client.query(
            "select m.user_id from public.admin_memberships m join private.auth_user_identity u on u.id=m.user_id where m.user_id=$1 and m.active and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now()) for share of m",
            [this.userId]
          )
        ).rows.length
      )
        throw new DesignDraftError("FORBIDDEN", "Current administrator access is required")
      const result = await work(client)
      await client.query("commit")
      return result
    } catch (error) {
      await client.query("rollback")
      throw error
    } finally {
      client.release()
    }
  }
  async freeze(input: DesignDraftInput) {
    return this.transaction(async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`draft-request:${input.requestId}`])
      const existing = (
        await client.query<Row>(
          "select *,input=$3::jsonb as matches from private.design_draft_requests where id=$1 and user_id=$2",
          [input.requestId, this.userId, JSON.stringify(input)]
        )
      ).rows[0]
      if (existing) {
        if (!existing.matches || existing.shop_id !== this.shopId)
          throw new DesignDraftError("CONFLICT", "Request ID already has different draft instructions")
        return
      }
      const scope =
        input.selection.kind === "numbers"
          ? input.selection.numbers
          : input.selection.kind === "revisions"
            ? input.selection.items.map((item) => item.designId)
            : null
      const clause =
        input.selection.kind === "numbers"
          ? "d.display_number=any($2::bigint[])"
          : input.selection.kind === "revisions"
            ? "d.id=any($2::uuid[])"
            : "f.revision_id is not null"
      const rows = (
        await client.query<Row>(
          `select d.*,coalesce(f.revision_id,d.current_revision_id) as selected_revision from public.library_designs d left join public.library_favorites f on f.design_id=d.id and f.user_id=$1 where ${clause} order by d.display_number`,
          scope ? [this.userId, scope] : [this.userId]
        )
      ).rows
      if (!rows.length || rows.length > 1000 || (scope && rows.length !== new Set<string | number>(scope).size))
        throw new DesignDraftError(
          "INVALID_INPUT",
          "Select existing designs or up to 1,000 complete personal favorites"
        )
      await client.query("insert into private.design_draft_requests(id,user_id,shop_id,input) values($1,$2,$3,$4)", [
        input.requestId,
        this.userId,
        this.shopId,
        input,
      ])
      for (const design of rows) {
        const revisionId =
          input.selection.kind === "revisions"
            ? input.selection.items.find((item) => item.designId === design.id)!.revisionId
            : String(design.selected_revision)
        const revision = (
          await client.query<Row>("select * from public.library_artwork_revisions where id=$1 and design_id=$2", [
            revisionId,
            design.id,
          ])
        ).rows[0]
        if (!revision)
          throw new DesignDraftError("INVALID_INPUT", "The selected artwork revision does not belong to its design")
        const assets = (
          await client.query<Row>("select * from public.library_assets where revision_id=$1", [revisionId])
        ).rows
        const print = assets.find((asset) => asset.kind === "print"),
          original = assets.find((asset) => asset.kind === "original")
        const error =
          original?.status !== "ready"
            ? "Store and verify the exact original before creating a product"
            : !print ||
                print.status !== "ready" ||
                print.mime_type !== "image/png" ||
                !print.has_alpha ||
                !print.has_transparency
              ? "Prepare and verify the transparent PNG before creating a product"
              : revision.print_readiness !== "ready" ||
                  !revision.width_inches ||
                  !revision.height_inches ||
                  !revision.native_ppi ||
                  print.enlarged === null
                ? "Complete the print assessment for this exact revision"
                : null
        const frozen = {
          designId: String(design.id),
          canonicalDesignId: String(design.canonical_design_id),
          displayNumber: Number(design.display_number),
          title: String(design.title),
          revisionId,
          asset: print ? mapPrivateArtworkAsset(print) : null,
        }
        let bindingId: string | null = null
        if (!error) {
          await client.query(
            "insert into public.library_product_bindings(canonical_design_id,shop_id,product_model_id,product_model_label,status,revision_id) values($1,$2,$3,$4,'reserved',$5) on conflict do nothing",
            [
              design.canonical_design_id,
              this.shopId,
              `printify-blueprint:${input.recipe.blueprintId}`,
              input.recipe.productModelLabel,
              revisionId,
            ]
          )
          const binding = (
            await client.query<Row>(
              "select * from public.library_product_bindings where canonical_design_id=$1 and shop_id=$2 and product_model_id=$3 for update",
              [design.canonical_design_id, this.shopId, `printify-blueprint:${input.recipe.blueprintId}`]
            )
          ).rows[0]!
          bindingId = String(binding.id)
          if (binding.status === "reserved") {
            // Only an explicit rejection or invalid pre-create input permits corrected frozen instructions.
            // Lease expiry or an empty inventory never proves that an ambiguous POST did not create a product.
            const superseded = await client.query(
              `update private.design_product_attempts a set request_id=$2,grant_id=$3,asset_id=$4,recipe=$5,title=$6,stage='pending',uploaded_image_id=null,lease_id=null,lease_expires_at=null,failure_code=null,provider_readback=null,updated_at=now()
              where a.binding_id=$1 and a.user_id=$7 and a.failure_code in ('PROVIDER_REJECTED','PRECREATE_INPUT_INVALID') and a.product_payload is null and a.observed_product_id is null and (a.lease_expires_at is null or a.lease_expires_at<now())
              and not exists(select 1 from private.design_product_candidates c where c.binding_id=a.binding_id) returning a.binding_id`,
              [
                bindingId,
                input.requestId,
                this.grantId,
                print!.id,
                input.recipe,
                input.recipe.titleTemplate
                  .replaceAll("{title}", String(design.title))
                  .replaceAll("{number}", String(design.display_number)),
                this.userId,
              ]
            )
            if (superseded.rows.length)
              await client.query(
                "update public.library_product_bindings set revision_id=$2,product_model_label=$3 where id=$1",
                [bindingId, revisionId, input.recipe.productModelLabel]
              )
            await client.query(
              "insert into private.design_product_attempts(binding_id,request_id,user_id,grant_id,asset_id,recipe,title) values($1,$2,$3,$4,$5,$6,$7) on conflict do nothing",
              [
                bindingId,
                input.requestId,
                this.userId,
                this.grantId,
                print!.id,
                input.recipe,
                input.recipe.titleTemplate
                  .replaceAll("{title}", String(design.title))
                  .replaceAll("{number}", String(design.display_number)),
              ]
            )
          }
        }
        await client.query(
          "insert into private.design_draft_items(request_id,design_id,canonical_design_id,revision_id,frozen,input_error,binding_id) values($1,$2,$3,$4,$5,$6,$7)",
          [input.requestId, design.id, design.canonical_design_id, revisionId, frozen, error, bindingId]
        )
      }
    })
  }
  /** The instructions a request was frozen with, so whoever continues it cannot drift from them. */
  async readInput(requestId: string): Promise<DesignDraftInput | null> {
    return this.transaction(async (client) => {
      const row = (
        await client.query<Row>(
          "select input from private.design_draft_requests where id=$1 and user_id=$2 and shop_id=$3",
          [requestId, this.userId, this.shopId]
        )
      ).rows[0]
      return row ? (row.input as DesignDraftInput) : null
    })
  }
  async results(requestId: string) {
    return this.transaction(async (client) => {
      const request = (
        await client.query("select id from private.design_draft_requests where id=$1 and user_id=$2 and shop_id=$3", [
          requestId,
          this.userId,
          this.shopId,
        ])
      ).rows[0]
      if (!request) throw new DesignDraftError("NOT_FOUND", "Draft request was not found for this owner")
      const rows = (
        await client.query<Row>(
          `select i.*,b.status,coalesce(b.product_id,a.observed_product_id) as product_id,b.revision_id as bound_revision,b.storefront_url,a.stage,a.failure_code,a.blocked_product_ids,(select coalesce(array_agg(c.product_id),'{}') from private.design_product_candidates c where c.binding_id=i.binding_id) as known_product_ids,a.request_id as operation_request,a.user_id as operation_owner from private.design_draft_items i left join public.library_product_bindings b on b.id=i.binding_id left join private.design_product_attempts a on a.binding_id=b.id where i.request_id=$1 order by (i.frozen->>'displayNumber')::int`,
          [requestId]
        )
      ).rows
      const results = rows.map((row): DesignDraftResult => {
        let status: DesignDraftResult["status"], message: string
        if (row.input_error) {
          status = "needs-input"
          message = String(row.input_error)
        } else if (row.status === "published") {
          status = "published"
          message = "This product is already in the store; its published revision was not changed"
        } else if (row.status === "draft" && row.bound_revision === row.revision_id) {
          status = "draft"
          message = "The existing draft is bound to this exact last-verified artwork revision"
        } else if (row.status === "draft") {
          status = "revision-mismatch"
          message =
            "An existing draft uses another revision; update that product explicitly rather than creating another"
        } else if (row.operation_request && row.operation_request !== requestId && row.status === "reserved") {
          status = "reserved-elsewhere"
          message =
            row.operation_owner === this.userId
              ? "Another request owns this model reservation; continue owningRequestId to recover its frozen work"
              : "Another owner has reserved this model; ask that owner to continue their existing request"
        } else if (
          ["PROVIDER_REJECTED", "PRECREATE_INPUT_INVALID", "UPLOAD_METADATA_MISMATCH"].includes(
            String(row.failure_code)
          )
        ) {
          status = "needs-input"
          message =
            row.failure_code === "PRECREATE_INPUT_INVALID"
              ? "Draft settings failed before product submission. Submit corrected settings with a new request ID, or repair the asset and continue this request"
              : row.failure_code === "PROVIDER_REJECTED"
                ? "Printify definitively rejected this request. Fix the draft token and retry this request, or submit corrected settings with a new request ID"
                : "The upload receipt did not match the prepared artwork. Continue this request to re-upload; the unused image receipt was saved"
        } else if (
          ["reserved", "creating"].includes(String(row.status)) &&
          ["pending", "uploading", "ready"].includes(String(row.stage)) &&
          row.operation_request === requestId
        ) {
          status = "busy"
          message = "Draft work is reserved; continue this same request"
        } else {
          status = "needs-reconciliation"
          const reasons: Record<string, string> = {
            INVENTORY_SOURCE_UNAVAILABLE:
              "A provider product's exact original could not be inspected. Review blockingProductIds, restore its original source, then reconcile this request",
            AMBIGUOUS_ARTWORK_MODEL:
              "Multiple provider products match this artwork. Resolve the listed products and reconcile this request",
            PREVIOUS_PRODUCT_NOW_ABSENT:
              "A proven existing product disappeared. This model remains reserved; review the removed product before another write",
            PRODUCT_CHANGED_OR_PUBLISHED:
              "An existing product has different settings or publication state. Review that product and reconcile this request",
            CREATE_OR_RECEIPT_UNCERTAIN:
              "Product submission or its saved receipt is uncertain. Reconcile this same request before another write",
          }
          message =
            reasons[String(row.failure_code)] ??
            "An existing, removed, or uncertain product owns this model; reconcile it before another write"
        }
        return {
          designId: String(row.design_id),
          requestedRevisionId: String(row.revision_id),
          boundRevisionId: (row.bound_revision as string | null) ?? null,
          productId: (row.product_id as string | null) ?? null,
          status,
          message,
          storefrontUrl: (row.storefront_url as string | null) ?? null,
          owningRequestId:
            row.operation_owner === this.userId ? ((row.operation_request as string | null) ?? null) : null,
          blockingProductIds:
            status === "needs-reconciliation"
              ? [
                  ...new Set([
                    ...((row.blocked_product_ids as string[] | null) ?? []),
                    ...((row.known_product_ids as string[] | null) ?? []),
                  ]),
                ]
              : [],
        }
      })
      return { requestId, results, pending: results.filter((result) => result.status === "busy").length }
    })
  }
  async next(requestId: string, reconcile = false): Promise<DesignDraftOperation | null> {
    return this.transaction(async (client) => {
      const stage = reconcile
        ? "a.stage in ('creating','attention') and a.uploaded_image_id is not null and (a.lease_expires_at is null or a.lease_expires_at<now())"
        : "a.stage in ('pending','uploading','ready') and (a.lease_expires_at is null or a.lease_expires_at<now())"
      const row = (
        await client.query<Row>(
          `select a.*,i.frozen,(select coalesce(jsonb_agg(c.product_id),'[]'::jsonb) from private.design_product_candidates c where c.binding_id=a.binding_id) as known_products from private.design_product_attempts a join private.design_draft_items i on i.binding_id=a.binding_id and i.request_id=a.request_id and i.frozen->'asset'->>'id'=a.asset_id::text join private.design_draft_requests r on r.id=a.request_id where a.request_id=$1 and r.user_id=$2 and r.shop_id=$3 and ${stage} order by a.created_at limit 1 for update of a skip locked`,
          [requestId, this.userId, this.shopId]
        )
      ).rows[0]
      if (!row) return null
      const leaseId = randomUUID()
      await client.query(
        "update private.design_product_attempts set lease_id=$2,lease_expires_at=now()+interval '3 minutes',grant_id=$3,updated_at=now() where binding_id=$1",
        [row.binding_id, leaseId, this.grantId]
      )
      return {
        bindingId: String(row.binding_id),
        requestId: String(row.request_id),
        userId: String(row.user_id),
        grantId: this.grantId,
        stage: String(row.stage),
        leaseId,
        uploadedImageId: row.uploaded_image_id as string | null,
        productPayload: row.product_payload as DesignProductPayload | null,
        observedProductId: row.observed_product_id as string | null,
        knownProductIds: row.known_products as string[],
        recipe: row.recipe as DesignDraftRecipe,
        title: String(row.title),
        selection: row.frozen as FrozenDesignSelection,
      }
    })
  }
  async issueCapability(operation: DesignDraftOperation) {
    const token = randomBytes(32).toString("base64url"),
      hash = createHash("sha256").update(token).digest("hex")
    return this.transaction(async (client) => {
      const row = await client.query(
        "update private.design_product_attempts set stage='uploading',updated_at=now() where binding_id=$1 and lease_id=$2 and stage in ('pending','uploading') returning binding_id",
        [operation.bindingId, operation.leaseId]
      )
      if (!row.rows.length) throw new DesignDraftError("CONFLICT", "Another worker owns this artwork upload")
      await client.query(
        "update private.design_provider_capabilities set revoked_at=now() where binding_id=$1 and revoked_at is null",
        [operation.bindingId]
      )
      await client.query(
        "insert into private.design_provider_capabilities(token_hash,binding_id,asset_id,revision_id,asset_sha256,user_id,grant_id,expires_at) values($1,$2,$3,$4,$5,$6,$7,now()+interval '5 minutes')",
        [
          hash,
          operation.bindingId,
          operation.selection.asset.id,
          operation.selection.revisionId,
          operation.selection.asset.sha256,
          this.userId,
          this.grantId,
        ]
      )
      return token
    })
  }
  async saveUpload(operation: DesignDraftOperation, imageId: string) {
    return this.transaction(async (client) => {
      const result = await client.query(
        "update private.design_product_attempts set uploaded_image_id=$3,stage='ready',failure_code=null,updated_at=now() where binding_id=$1 and lease_id=$2 and stage='uploading' and uploaded_image_id is null returning binding_id",
        [operation.bindingId, operation.leaseId, imageId]
      )
      if (result.rows.length)
        await client.query(
          "update private.design_provider_capabilities set revoked_at=now() where binding_id=$1 and revoked_at is null",
          [operation.bindingId]
        )
      return result.rows.length > 0
    }, false)
  }
  async startCreate(operation: DesignDraftOperation, payload: DesignProductPayload) {
    return this.transaction(async (client) => {
      const result = await client.query(
        "update private.design_product_attempts set stage='creating',product_payload=$3,updated_at=now() where binding_id=$1 and lease_id=$2 and stage in ('ready','attention') and product_payload is null and uploaded_image_id=$4 returning binding_id",
        [operation.bindingId, operation.leaseId, payload, operation.uploadedImageId]
      )
      if (result.rows.length)
        await client.query(
          "update public.library_product_bindings set status='creating' where id=$1 and status='reserved'",
          [operation.bindingId]
        )
      return result.rows.length > 0
    })
  }
  async observed(operation: DesignDraftOperation, productId: string) {
    await this.database.query(
      "update private.design_product_attempts set observed_product_id=$2,updated_at=now() where binding_id=$1 and stage='creating' and observed_product_id is null",
      [operation.bindingId, productId]
    )
  }
  async attention(operation: DesignDraftOperation, code: string) {
    await this.transaction(async (client) => {
      const updated = await client.query(
        "update private.design_product_attempts set stage='attention',failure_code=$2,lease_expires_at=null,updated_at=now() where binding_id=$1 and lease_id=$3 and stage<>'verified' returning binding_id",
        [operation.bindingId, code, operation.leaseId]
      )
      if (!updated.rows.length) return
      await client.query(
        "update public.library_product_bindings set status='needs-reconciliation' where id=$1 and status not in ('draft','published')",
        [operation.bindingId]
      )
      await client.query(
        "update private.design_provider_capabilities set revoked_at=now() where binding_id=$1 and revoked_at is null",
        [operation.bindingId]
      )
    }, false)
  }
  async retryUpload(
    operation: DesignDraftOperation,
    receipt?: { id: string; width: number; height: number; mimeType: string }
  ) {
    await this.transaction(async (client) => {
      const updated = await client.query(
        "update private.design_product_attempts set stage='pending',lease_expires_at=null,failure_code=$3,updated_at=now() where binding_id=$1 and lease_id=$2 and stage in ('pending','uploading') and product_payload is null returning binding_id",
        [operation.bindingId, operation.leaseId, receipt ? "UPLOAD_METADATA_MISMATCH" : null]
      )
      if (!updated.rows.length) return
      if (receipt)
        await client.query(
          "insert into private.design_draft_write_receipts(binding_id,request_id,kind,upload_receipt) values($1,$2,'upload-mismatch',$3)",
          [operation.bindingId, operation.requestId, receipt]
        )
      await client.query(
        "update private.design_provider_capabilities set revoked_at=now() where binding_id=$1 and revoked_at is null",
        [operation.bindingId]
      )
    }, false)
  }
  async releaseLease(operation: DesignDraftOperation, inputInvalid = false) {
    await this.database.query(
      "update private.design_product_attempts set lease_expires_at=null,failure_code=case when $3 and product_payload is null then 'PRECREATE_INPUT_INVALID' else failure_code end where binding_id=$1 and lease_id=$2",
      [operation.bindingId, operation.leaseId, inputInvalid]
    )
  }
  async resetUnsubmitted(operation: DesignDraftOperation, httpStatus?: number) {
    return this.transaction(async (client) => {
      const current = (
        await client.query<Row>(
          `select product_payload from private.design_product_attempts a where binding_id=$1 and lease_id=$2 and stage='creating' and observed_product_id is null
        and not exists(select 1 from private.design_product_candidates c where c.binding_id=a.binding_id) for update`,
          [operation.bindingId, operation.leaseId]
        )
      ).rows[0]
      if (!current) return false
      await client.query(
        "insert into private.design_draft_write_receipts(binding_id,request_id,kind,http_status,product_payload) values($1,$2,$3,$4,$5)",
        [
          operation.bindingId,
          operation.requestId,
          httpStatus ? "product-rejected" : "product-not-sent",
          httpStatus ?? null,
          current.product_payload,
        ]
      )
      await client.query(
        "update private.design_product_attempts set product_payload=null,stage='ready',failure_code=$3,lease_expires_at=null,updated_at=now() where binding_id=$1 and lease_id=$2",
        [operation.bindingId, operation.leaseId, httpStatus ? "PROVIDER_REJECTED" : "PRODUCT_NOT_SENT"]
      )
      await client.query(
        "update public.library_product_bindings set status='reserved' where id=$1 and product_id is null",
        [operation.bindingId]
      )
      return true
    }, false)
  }
  async saveReadback(operation: DesignDraftOperation, product: Record<string, unknown>) {
    const variants = Array.isArray(product.variants)
      ? product.variants.map((value) => {
          const variant = value as Record<string, unknown>
          return { id: variant.id, price: variant.price, is_enabled: variant.is_enabled }
        })
      : null
    await this.database.query(
      "update private.design_product_attempts set provider_readback=$3 where binding_id=$1 and lease_id=$2",
      [
        operation.bindingId,
        operation.leaseId,
        {
          productId: product.id,
          title: product.title,
          description: product.description,
          variants,
          productionFingerprint: productArtworkFingerprint(product, {
            shopId: this.shopId,
            productId: String(product.id),
          }),
        },
      ]
    )
  }
  async verify(operation: DesignDraftOperation, product: Record<string, unknown>, imageId: string) {
    const fingerprint = productArtworkFingerprint(product, { shopId: this.shopId, productId: String(product.id) })
    if (!fingerprint) throw new DesignDraftError("CONFLICT", "Provider production settings could not be verified")
    return this.transaction(async (client) => {
      const current = (
        await client.query(
          "select binding_id from private.design_product_attempts where binding_id=$1 and lease_id=$2 for update",
          [operation.bindingId, operation.leaseId]
        )
      ).rows[0]
      if (!current) throw new DesignDraftError("CONFLICT", "A newer worker owns product verification")
      const asset = operation.selection.asset
      await client.query(
        `insert into commerce.design_product_artwork(shop_id,product_id,production_fingerprint,revision_id,print_asset_id,print_sha256,printify_image_id,approved_by)
        values($1,$2,$3,$4,$5,$6,$7,$8) on conflict do nothing`,
        [
          this.shopId,
          product.id,
          fingerprint,
          operation.selection.revisionId,
          asset.id,
          asset.sha256,
          imageId,
          this.userId,
        ]
      )
      const receipt = (
        await client.query<{ matches: boolean }>(
          "select revision_id=$4::uuid and print_asset_id=$5::uuid and print_sha256=$6 as matches from commerce.design_product_artwork where shop_id=$1 and product_id=$2 and production_fingerprint=$3",
          [this.shopId, product.id, fingerprint, operation.selection.revisionId, asset.id, asset.sha256]
        )
      ).rows[0]
      if (!receipt?.matches)
        throw new DesignDraftError("CONFLICT", "An immutable artwork receipt already has different provenance")
      await client.query(
        "update public.library_product_bindings set product_id=$2,revision_id=$3,status='draft',verified_at=now() where id=$1 and status<>'published'",
        [operation.bindingId, product.id, operation.selection.revisionId]
      )
      await client.query(
        "update private.design_product_attempts set stage='verified',observed_product_id=$2,failure_code=null,lease_expires_at=null,updated_at=now() where binding_id=$1",
        [operation.bindingId, product.id]
      )
      await client.query(
        "update private.design_provider_capabilities set revoked_at=now() where binding_id=$1 and revoked_at is null",
        [operation.bindingId]
      )
    }, false)
  }
  async readBinding(bindingId: string) {
    return this.transaction(async (client) => {
      const row = (
        await client.query<Row>("select * from public.library_product_bindings where id=$1 and shop_id=$2", [
          bindingId,
          this.shopId,
        ])
      ).rows[0]
      if (!row) throw new DesignDraftError("NOT_FOUND", "The product binding was not found for this store")
      const asset = row.revision_id
        ? (
            await client.query<Row>(
              "select * from public.library_assets where revision_id=$1 and kind='print' and status='ready'",
              [row.revision_id]
            )
          ).rows[0]
        : null
      return {
        productId: row.product_id as string | null,
        revisionId: row.revision_id as string | null,
        modelId: String(row.product_model_id),
        status: String(row.status),
        asset: asset ? mapPrivateArtworkAsset(asset) : null,
      }
    })
  }
  async markBinding(bindingId: string, status: "removed" | "needs-reconciliation") {
    await this.transaction(async (client) => {
      await client.query("select id from public.library_product_bindings where id=$1 and shop_id=$2 for update", [
        bindingId,
        this.shopId,
      ])
      if (await this.restorePublishedArtwork(client, bindingId)) return
      await client.query(
        "update public.library_product_bindings set status=$3,storefront_url=null,verified_at=null where id=$1 and shop_id=$2",
        [bindingId, this.shopId, status]
      )
    })
  }
  async verifyBinding(
    bindingId: string,
    product: Record<string, unknown>,
    revisionId: string,
    asset: LibraryStoredAsset,
    imageId: string,
    draft: boolean
  ) {
    const fingerprint = productArtworkFingerprint(product, { shopId: this.shopId, productId: String(product.id) })
    if (!fingerprint) throw new DesignDraftError("CONFLICT", "Provider production settings could not be verified")
    return this.transaction(async (client) => {
      const binding = (
        await client.query(
          "select id from public.library_product_bindings where id=$1 and shop_id=$2 and product_id=$3 and revision_id=$4 for update",
          [bindingId, this.shopId, product.id, revisionId]
        )
      ).rows[0]
      if (!binding) throw new DesignDraftError("CONFLICT", "The product binding changed during verification")
      await client.query(
        "insert into commerce.design_product_artwork(shop_id,product_id,production_fingerprint,revision_id,print_asset_id,print_sha256,printify_image_id,approved_by) values($1,$2,$3,$4,$5,$6,$7,$8) on conflict do nothing",
        [this.shopId, product.id, fingerprint, revisionId, asset.id, asset.sha256, imageId, this.userId]
      )
      const receipt = (
        await client.query(
          "select 1 from commerce.design_product_artwork where shop_id=$1 and product_id=$2 and production_fingerprint=$3 and revision_id=$4 and print_asset_id=$5 and print_sha256=$6",
          [this.shopId, product.id, fingerprint, revisionId, asset.id, asset.sha256]
        )
      ).rows[0]
      if (!receipt) throw new DesignDraftError("CONFLICT", "The existing artwork receipt has different provenance")
      const published = await this.restorePublishedArtwork(client, bindingId)
      const status = published ? "published" : draft ? "draft" : "needs-reconciliation"
      if (!published)
        await client.query(
          "update public.library_product_bindings set status=$2,verified_at=case when $2<>'needs-reconciliation' then now() else null end,storefront_url=null where id=$1",
          [bindingId, status]
        )
      return status
    })
  }
  // Callers hold the binding lock so a concurrent publication callback runs after this reconciliation.
  private async restorePublishedArtwork(client: PoolClient, bindingId: string) {
    const published = (
      await client.query<{ revision_id: string; product_id: string }>(
        `select a.revision_id,p.product_id from public.library_product_bindings b join commerce.printify_products p on p.shop_id=b.shop_id and p.product_id=b.product_id and p.active join commerce.design_product_artwork a on a.shop_id=p.shop_id and a.product_id=p.product_id and a.revision_id::text=p.snapshot->'storefront_artwork'->>'revisionId' and a.production_fingerprint=p.snapshot->'storefront_artwork'->>'productionFingerprint' where b.id=$1 and b.shop_id=$2`,
        [bindingId, this.shopId]
      )
    ).rows[0]
    if (!published) return false
    await client.query(
      "update public.library_product_bindings set status='published',revision_id=$2,storefront_url=coalesce(storefront_url,$3),verified_at=now() where id=$1",
      [bindingId, published.revision_id, `/shop/${encodeURIComponent(published.product_id)}`]
    )
    return true
  }
  async readImageEvidence(imageId: string, src?: string) {
    const known = (
      await this.database.query<{ pixel_sha256: string; width: number; height: number }>(
        "select distinct a.pixel_sha256,a.width,a.height from commerce.design_product_artwork r join public.library_assets a on a.id=r.print_asset_id where r.shop_id=$1 and r.printify_image_id=$2 and a.pixel_sha256 is not null",
        [this.shopId, imageId]
      )
    ).rows
    if (known.length === 1)
      return { pixelSha256: known[0]!.pixel_sha256, width: known[0]!.width, height: known[0]!.height }
    if (known.length > 1)
      throw new DesignDraftError("CONFLICT", "A provider image has conflicting immutable artwork records")
    if (!src) return null
    const row = (
      await this.database.query<{ pixel_sha256: string; width: number; height: number }>(
        "select pixel_sha256,width,height from private.design_provider_source_evidence where shop_id=$1 and image_id=$2 and source_url_sha256=$3",
        [this.shopId, imageId, createHash("sha256").update(src).digest("hex")]
      )
    ).rows[0]
    return row ? { pixelSha256: row.pixel_sha256, width: row.width, height: row.height } : null
  }
  async saveImageEvidence(
    imageId: string,
    src: string,
    evidence: { sha256: string; pixelSha256: string; width: number; height: number }
  ) {
    await this.transaction(async (client) => {
      await client.query(
        "insert into private.design_provider_source_evidence(shop_id,image_id,source_url_sha256,sha256,pixel_sha256,width,height) values($1,$2,$3,$4,$5,$6,$7) on conflict do nothing",
        [
          this.shopId,
          imageId,
          createHash("sha256").update(src).digest("hex"),
          evidence.sha256,
          evidence.pixelSha256,
          evidence.width,
          evidence.height,
        ]
      )
      const saved = (
        await client.query(
          "select 1 from private.design_provider_source_evidence where shop_id=$1 and image_id=$2 and source_url_sha256=$3 and pixel_sha256=$4 and width=$5 and height=$6",
          [
            this.shopId,
            imageId,
            createHash("sha256").update(src).digest("hex"),
            evidence.pixelSha256,
            evidence.width,
            evidence.height,
          ]
        )
      ).rows[0]
      if (!saved)
        throw new DesignDraftError(
          "CONFLICT",
          "Provider original-source evidence changed; inspect that product explicitly"
        )
    })
  }
  async recordCandidate(operation: DesignDraftOperation, productId: string, imageId: string) {
    await this.transaction(async (client) => {
      await client.query(
        "insert into private.design_product_candidates(binding_id,product_id,image_id) values($1,$2,$3) on conflict do nothing",
        [operation.bindingId, productId, imageId]
      )
    })
    if (!operation.knownProductIds.includes(productId)) operation.knownProductIds.push(productId)
  }
  async blockInventory(operation: DesignDraftOperation, productId: string) {
    await this.transaction(async (client) => {
      await client.query(
        "update private.design_product_attempts set blocked_product_ids=array(select distinct unnest(blocked_product_ids||$3::text[])) where binding_id=$1 and lease_id=$2",
        [operation.bindingId, operation.leaseId, [productId]]
      )
    })
    await this.attention(operation, "INVENTORY_SOURCE_UNAVAILABLE")
  }
  async resumeAfterInspection(operation: DesignDraftOperation) {
    await this.transaction(async (client) => {
      const result = await client.query(
        "update private.design_product_attempts set stage='ready',failure_code=null,blocked_product_ids='{}',lease_expires_at=null where binding_id=$1 and lease_id=$2 and product_payload is null and not exists(select 1 from private.design_product_candidates where binding_id=$1) returning binding_id",
        [operation.bindingId, operation.leaseId]
      )
      if (result.rows.length)
        await client.query("update public.library_product_bindings set status='reserved' where id=$1", [
          operation.bindingId,
        ])
    })
  }
}
