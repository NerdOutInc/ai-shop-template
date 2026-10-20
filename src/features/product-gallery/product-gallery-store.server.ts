import "server-only"
import { randomUUID } from "node:crypto"
import type { Pool, PoolClient } from "pg"
import { readProductImageViewKey } from "@/features/catalog/read-product-image-view-key"
import { galleryManifestSchema, type GalleryManifest, type GalleryEntry } from "./gallery-manifest-schema"
import type { GalleryMutation, GalleryActivation } from "./gallery-mutation-schema"
import { GalleryError } from "./gallery-error"
import { readGallerySource } from "./read-gallery-source.server"
import { readGalleryImageLocation } from "./read-gallery-image-location"
import { isGalleryBindingCurrent } from "./is-gallery-binding-current.server"
import { productionFingerprintVersion } from "@/lib/printify/production-fingerprint-version"
import { galleryColorSelection } from "./gallery-color-selection"

export type GalleryAsset = {
  id: string
  pathname: string
  sha256: string
  bytes: number
  width: number
  height: number
  contentType: "image/jpeg"
}
type State = {
  snapshot: Record<string, unknown>
  productRevision: string
  active: boolean
  revision: string | null
  draft: unknown
  published: unknown
}
const empty: GalleryManifest = { version: 1, coverColor: null, colors: [] }
const assetColumns = 'id,pathname,sha256,bytes,width,height,content_type as "contentType"'

export class ProductGalleryStore {
  constructor(
    private readonly pool: Pool,
    private readonly shopId: string
  ) {}

  async read(product: string, client: Pool | PoolClient = this.pool): Promise<State> {
    const row = (
      await client.query<State>(
        `select p.snapshot,p.revision::text as "productRevision",p.active,
      g.revision,g.draft_manifest as draft,g.active_manifest as published
      from commerce.printify_products p left join commerce.product_galleries g using(shop_id,product_id)
      where p.shop_id=$1 and p.product_id=$2 and p.snapshot is not null`,
        [this.shopId, product]
      )
    ).rows[0]
    if (!row) throw new GalleryError("Publish this product before preparing its gallery.", 404)
    return row
  }

  async assets(product: string, client: Pool | PoolClient = this.pool, ids: string[] | null = null) {
    return (
      await client.query<GalleryAsset>(
        `select ${assetColumns} from commerce.product_gallery_assets where shop_id=$1 and product_id=$2 and ($3::uuid[] is null or id=any($3::uuid[])) order by created_at desc`,
        [this.shopId, product, ids]
      )
    ).rows
  }

  async asset(product: string, id: string, client: Pool | PoolClient = this.pool) {
    return (await this.assets(product, client, [id]))[0] ?? null
  }

  async assetCount(product: string) {
    return (
      await this.pool.query<{ count: number }>(
        "select count(*)::int as count from commerce.product_gallery_assets where shop_id=$1 and product_id=$2",
        [this.shopId, product]
      )
    ).rows[0]!.count
  }

  async addAsset(product: string, asset: GalleryAsset, actor: string) {
    await this.pool.query(
      `insert into commerce.product_gallery_assets (id,shop_id,product_id,pathname,sha256,bytes,width,height,content_type,created_by)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        asset.id,
        this.shopId,
        product,
        asset.pathname,
        asset.sha256,
        asset.bytes,
        asset.width,
        asset.height,
        asset.contentType,
        actor,
      ]
    )
  }

  async history(product: string) {
    return (
      await this.pool.query<{ revision: string; action: string; createdAt: Date }>(
        `select revision,action,created_at as "createdAt" from commerce.product_gallery_revisions where shop_id=$1 and product_id=$2 order by created_at desc limit 30`,
        [this.shopId, product]
      )
    ).rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))
  }

  async evidence(product: string, manifests: unknown[], client: Pool | PoolClient = this.pool) {
    const revisions = manifests.flatMap((m) => {
      const parsed = galleryManifestSchema.safeParse(m)
      return parsed.success
        ? parsed.data.colors.flatMap((c) =>
            c.reviewedBinding && c.reviewedBinding.version !== `gallery-v1/${productionFingerprintVersion}`
              ? [c.reviewedBinding.sourceRevision]
              : []
          )
        : []
    })
    if (!revisions.length) return {}
    const rows = (
      await client.query<{ revision: string; snapshot: Record<string, unknown> }>(
        `select revision::text,snapshot from commerce.printify_product_revisions where shop_id=$1 and product_id=$2 and revision=any($3::bigint[])`,
        [this.shopId, product, revisions]
      )
    ).rows
    return Object.fromEntries(rows.map((r) => [r.revision, r.snapshot]))
  }

  private async transaction<T>(
    product: string,
    expected: { revision: string | null; productRevision?: string },
    operation: (client: PoolClient, state: State) => Promise<T>
  ) {
    const client = await this.pool.connect()
    try {
      await client.query("begin")
      await client.query("set local lock_timeout = '3s'; set local statement_timeout = '5s'")
      await client.query(
        "select product_id from commerce.printify_products where shop_id=$1 and product_id=$2 for update",
        [this.shopId, product]
      )
      await client.query(
        "select revision from commerce.product_galleries where shop_id=$1 and product_id=$2 for update",
        [this.shopId, product]
      )
      const state = await this.read(product, client)
      if (
        state.revision !== expected.revision ||
        (expected.productRevision !== undefined && state.productRevision !== expected.productRevision)
      )
        throw new GalleryError("The product or gallery changed. Reload the saved state before continuing.")
      const result = await operation(client, state)
      await client.query("commit")
      return result
    } catch (error) {
      await client.query("rollback").catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  private async record(
    client: PoolClient,
    product: string,
    state: State,
    manifest: GalleryManifest,
    action: "save" | "restore" | "activate",
    actor: string
  ) {
    // Upgrade only proven equivalent bindings on writes, never by mutating a public read.
    if (action !== "activate") {
      const source = readGallerySource(state.snapshot, state.productRevision)
      const evidence = await this.evidence(product, [manifest, state.published], client)
      const historicalSources = new Map<string, ReturnType<typeof readGallerySource>>()
      const upgrade = (value: unknown) => {
        const parsed = galleryManifestSchema.safeParse(value)
        if (!parsed.success) return value
        for (const color of parsed.data.colors) {
          const current = source.colors.find((c) => c.key === color.colorKey)?.binding
          if (
            current &&
            color.reviewedBinding?.version !== current.version &&
            isGalleryBindingCurrent(color.reviewedBinding, current, color.colorKey, evidence, historicalSources)
          )
            color.reviewedBinding = current
        }
        return parsed.data
      }
      manifest = upgrade(manifest) as GalleryManifest
      state.published = upgrade(state.published)
    }
    const revision = randomUUID()
    await client.query(
      `insert into commerce.product_galleries(shop_id,product_id,revision,draft_manifest,active_manifest,updated_by)
      values($1,$2,$3,$4,$5,$6) on conflict(shop_id,product_id) do update
      set revision=excluded.revision,draft_manifest=excluded.draft_manifest,active_manifest=excluded.active_manifest,updated_by=excluded.updated_by,updated_at=now()`,
      [
        this.shopId,
        product,
        revision,
        JSON.stringify(manifest),
        action === "activate"
          ? JSON.stringify(manifest)
          : state.published == null
            ? null
            : JSON.stringify(state.published),
        actor,
      ]
    )
    await client.query(
      `insert into commerce.product_gallery_revisions(shop_id,product_id,revision,action,manifest,created_by) values($1,$2,$3,$4,$5,$6)`,
      [this.shopId, product, revision, action, JSON.stringify(manifest), actor]
    )
    // Activation changes the public page, so it stamps the product's content date (the sitemap's
    // lastmod) like a publication does. Draft saves and restores leave the public photos alone.
    if (action === "activate")
      await client.query("update commerce.printify_products set updated_at=now() where shop_id=$1 and product_id=$2", [
        this.shopId,
        product,
      ])
    return { revision }
  }

  async save(
    product: string,
    input: Exclude<GalleryMutation, GalleryActivation>,
    actor: string,
    host: string | undefined
  ) {
    return this.transaction(product, { revision: input.revision }, async (client, state) => {
      const source = readGallerySource(state.snapshot, state.productRevision)
      const draft = galleryManifestSchema.safeParse(state.draft)
      const active = galleryManifestSchema.safeParse(state.published)
      const locked = [
        ...new Set([
          ...(draft.success ? draft.data.colors.map((c) => c.colorKey) : []),
          ...(active.success ? active.data.colors.map((c) => c.colorKey) : []),
        ]),
      ].filter((key) => !source.colors.some((c) => c.key === key && c.variantIds.length))
      const retained = (
        colors: (
          GalleryManifest["colors"][number] | Extract<GalleryMutation, { action: "save" }>["manifest"]["colors"][number]
        )[]
      ) =>
        [...new Set([...locked, ...colors.map((color) => color.colorKey)])]
          .filter((key) => !source.colors.some((color) => color.key === key && color.variantIds.length))
          .flatMap((key) => {
            const choice = colors.find((c) => c.colorKey === key)
            const previous = draft.success ? draft.data.colors.find((c) => c.colorKey === key) : undefined
            const published = active.success ? active.data.colors.find((c) => c.colorKey === key) : undefined
            const same = (candidate: typeof previous) =>
              JSON.stringify(galleryColorSelection(choice)) === JSON.stringify(galleryColorSelection(candidate))
            // Old drafts can explicitly recover the active choices; they cannot approve new dormant photos.
            const canonical = same(previous) ? previous : same(published) ? published : false
            if (canonical === false)
              throw new GalleryError(
                `${source.colors.find((c) => c.key === key)?.title ?? key} is unavailable. Refresh product, then keep its saved photos or restore its last active selection.`
              )
            return canonical ? [canonical] : []
          })
      if (input.action === "restore") {
        const row = (
          await client.query<{ manifest: unknown }>(
            "select manifest from commerce.product_gallery_revisions where shop_id=$1 and product_id=$2 and revision=$3",
            [this.shopId, product, input.fromRevision]
          )
        ).rows[0]
        const parsed = galleryManifestSchema.safeParse(row?.manifest)
        if (!parsed.success) throw new GalleryError("That saved gallery cannot be restored.")
        parsed.data.colors = [
          ...retained(parsed.data.colors),
          ...parsed.data.colors.filter((c) => !locked.includes(c.colorKey)),
        ]
        return this.record(client, product, state, parsed.data, "restore", actor)
      }
      const prior = [...(draft.success ? draft.data.colors : []), ...(active.success ? active.data.colors : [])]
      const manifest: GalleryManifest = {
        version: 1,
        coverColor: input.manifest.coverColor,
        colors: retained(input.manifest.colors),
      }
      if (
        manifest.coverColor &&
        !source.colors.some((c) => c.key === manifest.coverColor && c.variantIds.length) &&
        (!draft.success || draft.data.coverColor !== manifest.coverColor)
      )
        throw new GalleryError("Choose a current cover color.")
      const ownedAssets = new Set(
        (
          await this.assets(
            product,
            client,
            input.manifest.colors.flatMap((color) =>
              color.entries.flatMap((entry) => (entry.source === "store" ? [entry.assetId] : []))
            )
          )
        ).map((asset) => asset.id)
      )
      for (const color of input.manifest.colors) {
        if (locked.includes(color.colorKey)) continue
        const current = source.colors.find((c) => c.key === color.colorKey)
        if (
          !current?.variantIds.length &&
          (!draft.success || !draft.data.colors.some((c) => c.colorKey === color.colorKey))
        )
          throw new GalleryError("Choose an available color for a new photo selection.")
        const entries: GalleryEntry[] = []
        for (const entry of color.entries) {
          if (entry.source === "store") {
            if (!ownedAssets.has(entry.assetId)) throw new GalleryError("Choose an uploaded photo from this product.")
            entries.push({ ...entry })
          } else {
            const location = readGalleryImageLocation(entry.src, host, "provider")
            if (!location) throw new GalleryError("Provider photos must be backed up to the product image store first.")
            const live = source.images.find(
              (i) => i.src === entry.src && i.variant_ids.some((id) => current?.variantIds.includes(id))
            )
            let existing = prior
              .filter((c) => c.colorKey === color.colorKey)
              .flatMap((c) => c.entries)
              .find((e) => e.source === "provider" && e.src === entry.src)
            if (!existing) {
              const rows = (
                await client.query<{ manifest: unknown }>(
                  `select manifest from commerce.product_gallery_revisions where shop_id=$1 and product_id=$2 and manifest @> $3::jsonb order by created_at desc limit 1`,
                  [
                    this.shopId,
                    product,
                    JSON.stringify({
                      colors: [{ colorKey: color.colorKey, entries: [{ source: "provider", src: entry.src }] }],
                    }),
                  ]
                )
              ).rows
              const old = galleryManifestSchema.safeParse(rows[0]?.manifest)
              existing = old.success
                ? old.data.colors
                    .find((c) => c.colorKey === color.colorKey)
                    ?.entries.find((e) => e.source === "provider" && e.src === entry.src)
                : undefined
            }
            if (!live && (!existing || existing.source !== "provider"))
              throw new GalleryError("Choose a provider photo belonging to this product and color.")
            if (!existing && state.productRevision !== input.productRevision)
              throw new GalleryError(
                "The product changed. Refresh the product and review newly selected Printify photos before saving."
              )
            const viewKey = existing ? existing.viewKey : live ? readProductImageViewKey(live) : undefined
            entries.push({
              source: "provider",
              src: entry.src,
              alt: entry.alt,
              role: entry.role,
              sha256: location.sha256,
              sourceRevision: existing?.source === "provider" ? existing.sourceRevision : state.productRevision,
              ...(viewKey ? { viewKey } : {}),
            })
          }
        }
        const previous = draft.success ? draft.data.colors.find((c) => c.colorKey === color.colorKey) : undefined
        const identity = (entry: GalleryEntry) =>
          entry.source === "store" ? `store:${entry.assetId}` : `provider:${entry.src}`
        const reviewedPhotos = new Set(previous?.entries.map(identity))
        manifest.colors.push({
          colorKey: color.colorKey,
          entries,
          reviewedBinding: entries.every((entry) => reviewedPhotos.has(identity(entry)))
            ? (previous?.reviewedBinding ?? null)
            : null,
        })
      }
      const parsed = galleryManifestSchema.safeParse(manifest)
      if (!parsed.success) throw new GalleryError("Use distinct photos and colors, with at most 120 photos.", 400)
      return this.record(client, product, state, parsed.data, "save", actor)
    })
  }

  private async prepare(client: PoolClient, product: string, state: State, input: GalleryActivation) {
    if (!state.active) throw new GalleryError("Republish this product before activating its gallery.")
    const parsed = galleryManifestSchema.safeParse(state.draft)
    if (!parsed.success) throw new GalleryError("Save a valid draft before activation.")
    const manifest = parsed.data
    const active = galleryManifestSchema.safeParse(state.published)
    const source = readGallerySource(state.snapshot, state.productRevision)
    const evidence = await this.evidence(product, [state.draft, state.published], client)
    const historicalSources = new Map<string, ReturnType<typeof readGallerySource>>()
    for (const key of Object.keys(input.confirmations))
      if (!manifest.colors.some((c) => c.colorKey === key)) throw new GalleryError("Confirm only colors in this draft.")
    for (const color of manifest.colors) {
      const current = source.colors.find((c) => c.key === color.colorKey)
      const confirmation = input.confirmations[color.colorKey]
      if (confirmation) {
        if (!current?.binding || current.binding.digest !== confirmation)
          throw new GalleryError(`Review ${current?.title ?? color.colorKey} again; its production settings changed.`)
        color.reviewedBinding = current.binding
      }
      const fresh = isGalleryBindingCurrent(
        color.reviewedBinding,
        current?.binding ?? null,
        color.colorKey,
        evidence,
        historicalSources
      )
      if (!fresh) {
        const before = active.success ? active.data.colors.find((c) => c.colorKey === color.colorKey) : undefined
        const cleanEntries = (entries: GalleryEntry[]) =>
          entries.map((e) => {
            const copy = { ...e }
            if (copy.source === "store") delete copy.publicUrl
            return copy
          })
        if (
          !before ||
          isGalleryBindingCurrent(
            before.reviewedBinding,
            current?.binding ?? null,
            color.colorKey,
            evidence,
            historicalSources
          ) ||
          JSON.stringify(cleanEntries(before.entries)) !== JSON.stringify(cleanEntries(color.entries))
        )
          throw new GalleryError(`Confirm the photos for ${current?.title ?? color.colorKey} before activation.`)
      }
    }
    return manifest
  }

  async activationPlan(product: string, input: GalleryActivation) {
    return this.transaction(product, input, async (client, state) => {
      const manifest = await this.prepare(client, product, state, input)
      const source = readGallerySource(state.snapshot, state.productRevision)
      return {
        manifest,
        photoLabels: Object.fromEntries(
          manifest.colors.flatMap((color) =>
            color.entries.flatMap((entry, index) =>
              entry.source === "store"
                ? [
                    [
                      entry.assetId,
                      `${source.colors.find((c) => c.key === color.colorKey)?.title ?? color.colorKey}, photo ${index + 1}`,
                    ],
                  ]
                : []
            )
          )
        ),
        assets: await this.assets(
          product,
          client,
          manifest.colors.flatMap((color) =>
            color.entries.flatMap((entry) => (entry.source === "store" ? [entry.assetId] : []))
          )
        ),
      }
    })
  }

  private async promotions(product: string, ids: string[], host: string, client: Pool | PoolClient) {
    return (
      await client.query<{ assetId: string; url: string; sha256: string }>(
        'select asset_id as "assetId",url,sha256 from commerce.product_gallery_promotions where shop_id=$1 and product_id=$2 and asset_id=any($3::uuid[]) and host=$4',
        [this.shopId, product, ids, host]
      )
    ).rows
  }

  async promotion(product: string, asset: GalleryAsset, host: string, client: Pool | PoolClient = this.pool) {
    return (await this.promotions(product, [asset.id], host, client))[0] ?? null
  }

  async recordPromotion(product: string, asset: GalleryAsset, host: string, url: string) {
    if (readGalleryImageLocation(url, host, "store")?.sha256 !== asset.sha256)
      throw new Error("Invalid public photo location")
    await this.pool.query(
      "insert into commerce.product_gallery_promotions(shop_id,product_id,asset_id,host,url,sha256) values($1,$2,$3,$4,$5,$6) on conflict do nothing",
      [this.shopId, product, asset.id, host, url, asset.sha256]
    )
  }

  async activate(product: string, input: GalleryActivation, actor: string, host: string) {
    return this.transaction(product, input, async (client, state) => {
      const manifest = await this.prepare(client, product, state, input)
      const ids = manifest.colors.flatMap((color) =>
        color.entries.flatMap((entry) => (entry.source === "store" ? [entry.assetId] : []))
      )
      const assets = new Map((await this.assets(product, client, ids)).map((asset) => [asset.id, asset]))
      const receipts = new Map(
        (await this.promotions(product, ids, host, client)).map((receipt) => [receipt.assetId, receipt])
      )
      for (const color of manifest.colors)
        for (const entry of color.entries) {
          if (entry.source === "provider") {
            if (!readGalleryImageLocation(entry.src, host, "provider"))
              throw new GalleryError("A saved provider photo needs migration to the configured image store.")
            continue
          }
          const asset = assets.get(entry.assetId)
          const receipt = receipts.get(entry.assetId)
          if (
            !asset ||
            !receipt ||
            receipt.sha256 !== asset.sha256 ||
            readGalleryImageLocation(receipt.url, host, "store")?.sha256 !== asset.sha256
          )
            throw new GalleryError("Photo preparation is incomplete. Resume activation.")
          entry.publicUrl = receipt.url
        }
      return this.record(client, product, state, manifest, "activate", actor)
    })
  }

  emptyManifest() {
    return structuredClone(empty)
  }
}
