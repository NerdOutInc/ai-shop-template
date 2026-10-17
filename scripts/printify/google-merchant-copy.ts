import { readFile } from "node:fs/promises"

import { catalogProductSchema } from "../../src/features/catalog/catalog-product-schema"
import { readGoogleCopyProvenance } from "../../src/features/merchant-feed/read-google-copy-provenance.server"
import { normalizeCatalogProduct } from "../../src/features/catalog/normalize-catalog-product"
import { googleCopySharedFactsHash } from "../../src/features/merchant-feed/google-copy-shared-facts-hash"
import { resolveGoogleMerchantCopy } from "../../src/features/merchant-feed/resolve-google-merchant-copy"
import { validateGoogleCopyApproval } from "../../src/features/merchant-feed/validate-google-copy-approval"
import { PostgresPublishingStore } from "../../src/features/publishing/postgres-publishing-store.server"
import { createPostgresPool } from "../../src/lib/create-postgres-pool.server"
import { parsePrintifyProduct } from "../../src/lib/printify/parse-printify-product"

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === "--help") {
    console.log(
      "Dry-run published Google copy audit by default. --shop-id ID (required), --product-id ID, --after-product-id ID, --limit 1..100 (default 20). Propose with --input approved.json; only --preview shows owner-facing copy and review bindings. Write with --apply --approved --product-id ID --expected-revision N and --input approved.json or --clear. Apply/clear requires separate owner authorization. No provider reads, publication, callbacks or cache invalidation."
    )
    return
  }
  const flags = new Set<string>()
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (["--apply", "--approved", "--clear", "--preview"].includes(arg)) {
      if (flags.has(arg)) throw new Error("GOOGLE_COPY_INVALID_ARGUMENTS")
      flags.add(arg)
    } else {
      if (
        !["--shop-id", "--product-id", "--after-product-id", "--limit", "--input", "--expected-revision"].includes(
          arg
        ) ||
        values.has(arg)
      )
        throw new Error("GOOGLE_COPY_INVALID_ARGUMENTS")
      const value = args[++index]
      if (!value || value.startsWith("--")) throw new Error("GOOGLE_COPY_INVALID_ARGUMENTS")
      values.set(arg, value)
    }
  }
  const shopId = values.get("--shop-id")
  const productId = values.get("--product-id")
  const after = values.get("--after-product-id")
  const revision = values.get("--expected-revision")
  const limit = Number(values.get("--limit") ?? "20")
  const apply = flags.has("--apply")
  const clear = flags.has("--clear")
  if (
    !shopId ||
    !/^[1-9]\d*$/.test(shopId) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    [productId, after].some((id) => id !== undefined && !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) ||
    (productId && after) ||
    (revision !== undefined && !/^[1-9]\d*$/.test(revision)) ||
    (clear && values.has("--input")) ||
    ((clear || values.has("--input") || apply) && (!productId || !revision)) ||
    (apply && (!flags.has("--approved") || (!clear && !values.has("--input"))))
  )
    throw new Error("GOOGLE_COPY_INVALID_ARGUMENTS")
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error("GOOGLE_COPY_CONFIGURATION_MISSING")
  const input = values.has("--input")
    ? (JSON.parse(await readFile(values.get("--input")!, "utf8")) as unknown)
    : undefined
  const pool = createPostgresPool(databaseUrl, 1)
  const store = new PostgresPublishingStore(databaseUrl, shopId)
  try {
    const profiles = await store.garments.listFeedProfiles()
    const client = await pool.connect()
    try {
      await client.query("begin read only")
      await client.query("set local statement_timeout='5s'")
      const rows = (
        await client.query<{
          product_id: string
          revision: string
          snapshot: Record<string, unknown>
          active: boolean
          blocked: boolean
        }>(
          `select p.product_id,p.revision,p.snapshot,p.active, exists(select 1 from commerce.printify_publish_jobs j
          where j.shop_id=p.shop_id and j.product_id=p.product_id and j.state in ('pending','callback')) as blocked
          from commerce.printify_products p where p.shop_id=$1 and p.snapshot is not null
          and ($2::text is null or p.product_id=$2) and ($3::text is null or p.product_id>$3)
          order by p.product_id limit $4`,
          [shopId, productId ?? null, after ?? null, limit + 1]
        )
      ).rows
      const batch = rows.slice(0, limit)
      if (productId && !batch.length) throw new Error("GOOGLE_COPY_TARGET_MISSING")
      const results = []
      for (const row of batch) {
        if (revision !== undefined && row.revision !== revision) throw new Error("GOOGLE_COPY_REVISION_CHANGED")
        const parsed = catalogProductSchema.safeParse(row.snapshot)
        const product = parsed.success ? normalizeCatalogProduct(parsed.data) : null
        const production = product ? parsePrintifyProduct(row.snapshot, { productId: row.product_id, shopId }) : null
        if (!product || !production) {
          if (input !== undefined) throw new Error("GOOGLE_COPY_INVALID_SNAPSHOT")
          results.push({
            productId: row.product_id,
            revision: row.revision,
            active: row.active,
            blocked: row.blocked,
            code: "INVALID_SNAPSHOT",
          })
          continue
        }
        const profile =
          typeof row.snapshot.blueprint_id === "number" ? profiles.get(row.snapshot.blueprint_id) : undefined
        if (!profile) {
          if (input !== undefined) throw new Error("GOOGLE_COPY_UNSUPPORTED_BLUEPRINT")
          results.push({
            productId: row.product_id,
            revision: row.revision,
            active: row.active,
            blocked: row.blocked,
            code: "UNSUPPORTED_BLUEPRINT",
          })
          continue
        }
        const provenance =
          input !== undefined ? await readGoogleCopyProvenance(client, shopId, row.product_id, row.revision) : "unknown"
        const resolution =
          input !== undefined
            ? validateGoogleCopyApproval(input, row.snapshot, shopId, profile, provenance).resolved
            : resolveGoogleMerchantCopy(row.snapshot.google_merchant_copy, product, production, profile)
        // Exact saved agent-created recipe equality is evidence, not a guess about every draft.
        let legacyEvidence: string[] = []
        try {
          const evidence = await client.query<{ description: string; summary: string | null; agent_draft: boolean }>(
            `select a.recipe->>'description' as description,c.payload->>'summary' as summary,a.grant_id is not null as agent_draft
             from private.design_product_attempts a join public.library_product_bindings b on b.id=a.binding_id
             left join public.design_generation_candidates c on c.id=b.canonical_design_id and c.status in ('registered','ready')
             where b.shop_id=$1 and b.product_id=$2
             and a.recipe->>'description'=$3 and length(a.recipe->>'description')>0`,
            [shopId, row.product_id, row.snapshot.description]
          )
          legacyEvidence = [
            ...new Set(
              evidence.rows.flatMap((r) => {
                const summary = r.summary?.trim()
                const escaped = summary?.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
                return [
                  ...(r.agent_draft ? ["AGENT_DRAFT_RECIPE_MATCH_ORIGIN_UNCONFIRMED"] : []),
                  ...(escaped && r.description.startsWith(`<p><strong>The design</strong></p><p>${escaped}</p>`)
                    ? ["AGENT_GENERATED_SUMMARY_PUBLISHED"]
                    : []),
                ]
              })
            ),
          ]
        } catch {
          // Keep an unavailable provenance audit separate from the independently reviewed pilot.
          await client.query("rollback")
          await client.query("begin read only")
          await client.query("set local statement_timeout='5s'")
          legacyEvidence = ["LEGACY_ORIGIN_AUDIT_UNAVAILABLE"]
        }
        results.push({
          productId: row.product_id,
          revision: row.revision,
          active: row.active,
          blocked: row.blocked,
          usableVariantIds: [...resolution.variants.keys()],
          issues: resolution.issues,
          legacyEvidence,
          ...(flags.has("--preview")
            ? {
                approvalPreview: {
                  shared_facts_hash: googleCopySharedFactsHash(product, profile),
                  reviewed_variants: product.variants.map((v) => {
                    const saved = production.variants.find((p) => p.id === v.id)!
                    return {
                      id: v.id,
                      fingerprint: saved.fingerprint,
                      label: saved.label,
                      color: v.color,
                      size: v.size,
                    }
                  }),
                  descriptions: [...resolution.variants].map(([id, copy]) => ({ id, ...copy })),
                },
              }
            : {}),
        })
      }
      await client.query("commit")
      let newRevision: string | undefined
      if (apply) {
        if (batch.length !== 1 || !batch[0]!.active || batch[0]!.blocked) throw new Error("GOOGLE_COPY_WRITE_BLOCKED")
        const saved = await store.updateGoogleMerchantCopy(productId!, revision!, clear ? null : input)
        if (!saved) throw new Error("GOOGLE_COPY_WRITE_BLOCKED")
        newRevision = saved.newRevision
      }
      console.log(
        JSON.stringify({
          mode: apply ? "apply" : "dry-run",
          operation: clear ? "clear" : input !== undefined ? "replace" : "audit",
          shopId,
          ...(newRevision !== undefined ? { newRevision } : {}),
          results,
          nextAfterProductId: batch.at(-1)?.product_id ?? null,
          hasMore: rows.length > limit,
        })
      )
    } finally {
      client.release()
    }
  } finally {
    await pool.end()
    await store.close()
  }
}

main().catch((error: unknown) => {
  const code =
    error instanceof Error && /^GOOGLE_COPY_[A-Z_]+$/.test(error.message)
      ? error.message
      : "GOOGLE_COPY_OPERATION_FAILED"
  console.error(code)
  process.exitCode = 1
})
