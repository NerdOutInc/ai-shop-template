// @vitest-environment node
import { randomUUID } from "node:crypto"
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { Pool } from "pg"
import { createAdminDatabaseFixture } from "../../../test/create-admin-database-fixture"
import { createRuntimeLoginPool } from "../../../test/create-runtime-login-pool"
import { applyAllMigrations } from "../../../test/apply-all-migrations"
import { galleryProductFixture } from "../../../test/gallery-product-fixture"
import { ProductGalleryStore } from "./product-gallery-store.server"
import { PostgresPublishingStore } from "@/features/publishing/postgres-publishing-store.server"
import { readGallerySource } from "./read-gallery-source.server"
import { galleryManifestSchema } from "./gallery-manifest-schema"
import type { GalleryActivation } from "./gallery-mutation-schema"
import { resolveProductGallery } from "./resolve-product-gallery.server"
import { queryGalleryDisplay } from "./query-gallery-display.server"
import { applyGalleryDisplay, type GalleryDisplayRow } from "./apply-gallery-display.server"
vi.mock("server-only", () => ({}))
vi.mock("@/lib/env", () => ({
  env: { NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST: "galleryfixtures.public.blob.vercel-storage.com" },
}))
const url = process.env.PRODUCT_GALLERY_TEST_DATABASE_URL,
  actor = randomUUID(),
  assetId = randomUUID(),
  host = "galleryfixtures.public.blob.vercel-storage.com"
let pool: Pool, runtime: Pool, store: ProductGalleryStore
const asset = {
  id: assetId,
  pathname: `product-gallery/v1/${assetId}.jpg`,
  sha256: "b".repeat(64),
  bytes: 100,
  width: 1000,
  height: 1200,
  contentType: "image/jpeg" as const,
}
async function source(snapshot = galleryProductFixture(), revision = "1") {
  await pool.query(
    `insert into commerce.printify_products(shop_id,product_id,snapshot,revision,active,hidden_at) values('123',$1,$2,$3,true,null) on conflict(shop_id,product_id) do update set snapshot=excluded.snapshot,revision=excluded.revision,active=true`,
    [snapshot.id, JSON.stringify({ ...snapshot, shop_id: 123 }), revision]
  )
  await pool.query(
    "insert into commerce.printify_product_revisions(shop_id,product_id,revision,snapshot) values('123',$1,$2,$3) on conflict do nothing",
    [snapshot.id, revision, JSON.stringify({ ...snapshot, shop_id: 123 })]
  )
}
async function save() {
  await store.addAsset("shirt", asset, actor)
  const saved = await store.save(
    "shirt",
    {
      action: "save",
      revision: null,
      productRevision: "1",
      manifest: {
        coverColor: "10",
        colors: [
          { colorKey: "10", entries: [{ source: "store", assetId, alt: "A fixture tee", role: "female-lifestyle" }] },
        ],
      },
    },
    actor,
    host
  )
  return {
    action: "activate" as const,
    ...saved,
    productRevision: "1",
    confirmations: { "10": readGallerySource(galleryProductFixture(), "1").colors[0]!.binding!.digest },
  }
}
async function promote() {
  await store.recordPromotion("shirt", asset, host, `https://${host}/published-product-photos/v1/${asset.sha256}.jpg`)
}
describe.skipIf(!url)("product gallery durable publication boundary", () => {
  beforeAll(async () => {
    pool = await createAdminDatabaseFixture(url!)
    await applyAllMigrations(pool)
    runtime = await createRuntimeLoginPool(pool, url!)
    store = new ProductGalleryStore(runtime, "123")
  })
  afterAll(async () => {
    await runtime?.end()
    await pool?.end()
  })
  beforeEach(async () => {
    await pool.query(
      "truncate commerce.product_gallery_promotions,commerce.product_gallery_revisions,commerce.product_galleries,commerce.product_gallery_assets;delete from commerce.printify_product_revisions;delete from commerce.printify_products"
    )
    await source()
  })
  it("keeps drafts private, refuses unconfirmed activation and preserves active state on incomplete promotion", async () => {
    const input = await save()
    expect((await store.read("shirt")).published).toBeNull()
    await expect(store.activationPlan("shirt", { ...input, confirmations: {} })).rejects.toThrow(
      "Confirm the photos for Black"
    )
    await expect(store.activate("shirt", input, actor, host)).rejects.toThrow("incomplete")
    expect((await store.read("shirt")).published).toBeNull()
    await promote()
    await store.activate("shirt", input, actor, host)
    const current = await store.read("shirt")
    expect(current.published).toMatchObject({
      colors: [{ entries: [{ publicUrl: expect.stringContaining("published-product-photos") }] }],
    })
    const nextAsset = { ...asset, id: randomUUID(), pathname: `product-gallery/v1/${randomUUID()}.jpg` }
    await store.addAsset("shirt", nextAsset, actor)
    const next = await store.save(
      "shirt",
      {
        action: "save",
        revision: current.revision,
        productRevision: "1",
        manifest: {
          coverColor: "10",
          colors: [
            {
              colorKey: "10",
              entries: [{ source: "store", assetId: nextAsset.id, alt: "Replacement", role: "other" }],
            },
          ],
        },
      },
      actor,
      host
    )
    await expect(store.activate("shirt", { ...input, ...next }, actor, host)).rejects.toThrow("incomplete")
    expect((await store.read("shirt")).published).toEqual(current.published)
  })
  it("preserves curated images across provider mockup republishes, hide/show, removal and re-publication", async () => {
    const input = await save()
    await promote()
    await store.activate("shirt", input, actor, host)
    const original = (await store.read("shirt")).published,
      next = galleryProductFixture()
    next.images = []
    await source(next, "2")
    await pool.query("update commerce.printify_products set hidden_at=now() where product_id='shirt'")
    expect((await store.read("shirt")).published).toEqual(original)
    await pool.query("update commerce.printify_products set active=false where product_id='shirt'")
    const state = await store.read("shirt")
    await expect(
      store.activationPlan("shirt", { ...input, revision: state.revision, productRevision: "2" })
    ).rejects.toThrow("Republish")
    await source(next, "3")
    const final = await store.read("shirt")
    expect(
      resolveProductGallery({
        snapshot: final.snapshot,
        revision: final.productRevision,
        active: final.published,
        blobHost: host,
      }).staleColors
    ).toEqual([])
  })
  it.each(["disabled", "removed"])(
    "retains a %s color through edits to other colors, then restores its approved photos when it returns",
    async (gap) => {
      const initial = await save()
      await promote()
      const active = await store.activate("shirt", initial, actor, host)
      const original = galleryManifestSchema.parse((await store.read("shirt")).published)
      const snapshot = galleryProductFixture()
      snapshot.variants[0]!.is_enabled = false
      if (gap === "removed")
        snapshot.options[0]!.values = snapshot.options[0]!.values.filter((value) => value.id !== 10)
      await source(snapshot, "2")
      for (const colors of [
        [],
        original.colors.map((color) => ({
          ...color,
          entries: color.entries.map((entry) => ({ ...entry, alt: "Changed while unavailable" })),
        })),
      ]) {
        await expect(
          store.save(
            "shirt",
            { action: "save", ...active, productRevision: "2", manifest: { ...original, colors } },
            actor,
            host
          )
        ).rejects.toThrow("is unavailable")
      }
      expect((await store.read("shirt")).published).toEqual(original)
      // Simulate a draft saved by the old editor before the color went unavailable.
      const stranded = structuredClone(original)
      stranded.colors[0]!.entries[0]!.alt = "Earlier edit awaiting review"
      await pool.query("update commerce.product_galleries set draft_manifest=$1 where product_id='shirt'", [
        JSON.stringify(stranded),
      ])
      const saved = await store.save(
        "shirt",
        {
          action: "save",
          ...active,
          productRevision: "2",
          manifest: {
            ...original,
            colors: [
              ...original.colors,
              {
                colorKey: "20",
                entries: [{ source: "provider", src: snapshot.images[0]!.src, alt: "Navy tee", role: "garment" }],
              },
            ],
          },
        },
        actor,
        host
      )
      await store.activate(
        "shirt",
        {
          action: "activate",
          ...saved,
          productRevision: "2",
          confirmations: {
            "20": readGallerySource(snapshot, "2").colors.find((color) => color.key === "20")!.binding!.digest,
          },
        },
        actor,
        host
      )
      const state = await store.read("shirt")
      const published = galleryManifestSchema.parse(state.published)
      expect(published.coverColor).toBe("10")
      expect(published.colors[0]).toEqual(original.colors[0])
      const resolve = (current: typeof snapshot) =>
        resolveProductGallery({ snapshot: current, active: published, revision: "3", blobHost: host })
      expect(resolve(snapshot).staleColors).toEqual([])
      const returned = galleryProductFixture()
      const display = resolve(returned).snapshot.images as { src: string; variant_ids: number[]; is_default: boolean }[]
      expect(display.filter((image) => image.variant_ids.includes(101))).toEqual([
        expect.objectContaining({ src: expect.stringContaining("published-product-photos"), is_default: true }),
      ])
      returned.print_areas[0]!.placeholders[0]!.images[0]!.y = 0.8
      expect(resolve(returned).withheldVariantIds).toContain(101)
      expect(
        (resolve(returned).snapshot.images as { variant_ids: number[] }[]).some((image) =>
          image.variant_ids.includes(101)
        )
      ).toBe(false)
    }
  )
  it("refuses a publication race after promotion and cannot refresh an old draft by saving it", async () => {
    const input = await save()
    await promote()
    const changed = galleryProductFixture()
    changed.print_areas[0]!.placeholders[0]!.images[0]!.x = 0.7
    await source(changed, "2")
    await expect(store.activate("shirt", input, actor, host)).rejects.toThrow("changed")
    await expect(store.activationPlan("shirt", { ...input, productRevision: "2" })).rejects.toThrow(
      "production settings changed"
    )
    expect((await store.read("shirt")).published).toBeNull()
  })
  it("refuses cross-product private asset references", async () => {
    const input = await save()
    const mutation = {
      action: "save" as const,
      revision: input.revision,
      productRevision: "1",
      manifest: { coverColor: null, colors: [] },
    }
    await source({ ...galleryProductFixture(), id: "other" })
    await expect(
      store.save(
        "other",
        {
          ...mutation,
          revision: null,
          manifest: {
            coverColor: null,
            colors: [{ colorKey: "10", entries: [{ source: "store", assetId, alt: "Other", role: "other" }] }],
          },
        },
        actor,
        host
      )
    ).rejects.toThrow("from this product")
  })
  it("retains a chosen provider photo even after Printify removes it", async () => {
    const snapshot = galleryProductFixture(),
      src = snapshot.images[0]!.src
    const mutation = {
      action: "save" as const,
      revision: null as string | null,
      productRevision: "1",
      manifest: {
        coverColor: "10",
        colors: [
          {
            colorKey: "10",
            entries: [{ source: "provider" as const, src, alt: "Provider front", role: "garment" as const }],
          },
        ],
      },
    }
    const saved = await store.save("shirt", mutation, actor, host)
    snapshot.images = []
    await source(snapshot, "2")
    const next = await store.save("shirt", { ...mutation, revision: saved.revision, productRevision: "2" }, actor, host)
    expect(next.revision).not.toBe(saved.revision)
  })
  it("resolves the active gallery from one display read and recomputes historical bindings", async () => {
    const input = await save()
    await promote()
    await store.activate("shirt", input, actor, host)
    const display = async () => {
      const row = (
        await queryGalleryDisplay<GalleryDisplayRow>(
          runtime,
          "snapshot,revision::text as revision",
          "where shop_id=$1 and product_id=$2",
          ["123", "shirt"]
        )
      ).rows[0]!
      return applyGalleryDisplay(row)
    }
    const current = await display()
    const images = current.snapshot.images as { src: string; variant_ids: number[]; origin?: string }[]
    expect(images).toContainEqual(
      expect.objectContaining({ src: expect.stringContaining("published-product-photos"), origin: "store" })
    )
    expect(current.withheldVariantIds).toEqual([])
    await pool.query(
      `update commerce.product_galleries set active_manifest=jsonb_set(jsonb_set(active_manifest,'{colors,0,reviewedBinding,version}','"gallery-v1/old"'),'{colors,0,reviewedBinding,digest}',to_jsonb($1::text))`,
      ["f".repeat(64)]
    )
    expect((await display()).snapshot.images).toEqual(current.snapshot.images)
    const changed = galleryProductFixture()
    changed.print_areas[0]!.placeholders[0]!.images[0]!.y = 0.9
    await source(changed, "2")
    expect((await display()).withheldVariantIds).toEqual([101])
  })
  it("retains frozen provider provenance when saving another color after a production change", async () => {
    const snapshot = galleryProductFixture(),
      src = snapshot.images[0]!.src
    const black = {
      colorKey: "10",
      entries: [
        {
          source: "provider" as const,
          src,
          alt: "Provider front",
          role: "garment" as const,
          viewKey: "client-invention",
        },
      ],
    }
    const mutation = {
      action: "save" as const,
      revision: null as string | null,
      productRevision: "1",
      manifest: { coverColor: null, colors: [black] },
    }
    const saved = await store.save("shirt", mutation, actor, host)
    const activated = await store.activate(
      "shirt",
      {
        action: "activate",
        ...saved,
        productRevision: "1",
        confirmations: { "10": readGallerySource(snapshot, "1").colors[0]!.binding!.digest },
      },
      actor,
      host
    )
    snapshot.print_areas[0]!.placeholders[0]!.images[0]!.y = 0.8
    await source(snapshot, "2")
    const next = await store.save(
      "shirt",
      {
        ...mutation,
        revision: activated.revision,
        productRevision: "2",
        manifest: { coverColor: null, colors: [black, { ...black, colorKey: "20" }] },
      },
      actor,
      host
    )
    expect((await store.read("shirt")).draft).toMatchObject({
      colors: expect.arrayContaining([
        expect.objectContaining({ colorKey: "10", entries: [expect.objectContaining({ sourceRevision: "1" })] }),
      ]),
    })
    const prepared = await store.activationPlan("shirt", {
      action: "activate",
      ...next,
      productRevision: "2",
      confirmations: { "20": readGallerySource(snapshot, "2").colors[1]!.binding!.digest },
    })
    expect(prepared.manifest.colors[0]!.entries[0]).not.toHaveProperty("viewKey")
  })
  it("allows stale unchanged colors to remain withheld, but requires review of changed selections", async () => {
    const input = await save()
    await promote()
    await store.activate("shirt", input, actor, host)
    const changed = galleryProductFixture()
    changed.print_areas[0]!.placeholders[0]!.images[0]!.y = 0.9
    await source(changed, "2")
    let state = await store.read("shirt")
    const stale: GalleryActivation = {
      action: "activate",
      revision: state.revision,
      productRevision: "2",
      confirmations: {},
    }
    await expect(store.activationPlan("shirt", stale)).resolves.toBeDefined()
    const edited = await store.save(
      "shirt",
      {
        action: "save",
        revision: state.revision,
        productRevision: "2",
        manifest: {
          coverColor: null,
          colors: [
            { colorKey: "10", entries: [{ source: "store", assetId, alt: "Changed selection", role: "other" }] },
          ],
        },
      },
      actor,
      host
    )
    state = await store.read("shirt")
    expect(state.draft).toMatchObject({
      colors: [{ reviewedBinding: readGallerySource(galleryProductFixture(), "1").colors[0]!.binding }],
    })
    await expect(store.activationPlan("shirt", { ...stale, revision: edited.revision })).rejects.toThrow("Confirm")
  })
  it("reads provider images before the gallery migration without masking other missing tables", async () => {
    const read = () =>
      queryGalleryDisplay<GalleryDisplayRow>(
        runtime,
        "snapshot,revision::text as revision",
        "where shop_id=$1 and product_id=$2",
        ["123", "shirt"]
      )
    await pool.query("alter table commerce.product_galleries rename to product_galleries_migration_test")
    try {
      const row = (await read()).rows[0]!
      expect(row).toMatchObject({ gallery_active: null, gallery_history: {} })
      expect(applyGalleryDisplay(row)).toMatchObject({
        snapshot: { images: galleryProductFixture().images },
        withheldVariantIds: [],
      })
    } finally {
      await pool.query("alter table commerce.product_galleries_migration_test rename to product_galleries")
    }
    await pool.query(
      "alter table commerce.printify_product_revisions rename to printify_product_revisions_migration_test"
    )
    try {
      await expect(read()).rejects.toMatchObject({ code: "42P01" })
    } finally {
      await pool.query(
        "alter table commerce.printify_product_revisions_migration_test rename to printify_product_revisions"
      )
    }
  })
  it("preserves store-only edits and restores across unrelated updates while guarding new provider selections", async () => {
    const input = await save()
    const next = galleryProductFixture()
    next.title = "Updated title"
    await source(next, "2")
    const manifest = {
      coverColor: "10",
      colors: [
        {
          colorKey: "10",
          entries: [{ source: "store" as const, assetId, alt: "Updated caption", role: "other" as const }],
        },
      ],
    }
    const saved = await store.save(
      "shirt",
      { action: "save", revision: input.revision, productRevision: "1", manifest },
      actor,
      host
    )
    expect((await store.read("shirt")).draft).toMatchObject({ colors: [{ entries: [{ alt: "Updated caption" }] }] })
    const newProvider = {
      coverColor: null,
      colors: [
        {
          colorKey: "20",
          entries: [
            { source: "provider" as const, src: next.images[0]!.src, alt: "Blue tee", role: "garment" as const },
          ],
        },
      ],
    }
    await expect(
      store.save("shirt", { action: "save", ...saved, productRevision: "1", manifest: newProvider }, actor, host)
    ).rejects.toThrow("newly selected Printify photos")
    const restored = await store.save(
      "shirt",
      { action: "restore", ...saved, productRevision: "1", fromRevision: input.revision! },
      actor,
      host
    )
    expect((await store.read("shirt")).draft).toMatchObject({ colors: [{ entries: [{ alt: "A fixture tee" }] }] })
    await expect(store.activationPlan("shirt", { ...input, ...restored })).rejects.toThrow("changed")
  })
  it("requires fresh review before exposing added photos or re-curating a color", async () => {
    const input = await save()
    await promote()
    let current = await store.activate("shirt", input, actor, host)
    const entry = { source: "store" as const, assetId, alt: "New caption", role: "female-lifestyle" as const }
    const saveDraft = (entries: (typeof entry)[] | null) =>
      store.save(
        "shirt",
        {
          action: "save",
          ...current,
          productRevision: "1",
          manifest: { coverColor: null, colors: entries ? [{ colorKey: "10", entries }] : [] },
        },
        actor,
        host
      )
    const extra = { ...asset, id: randomUUID(), pathname: `product-gallery/v1/${randomUUID()}.jpg` }
    await store.addAsset("shirt", extra, actor)
    current = await saveDraft([entry, { ...entry, assetId: extra.id }])
    await expect(store.activationPlan("shirt", { ...input, ...current, confirmations: {} })).rejects.toThrow("Confirm")
    current = await saveDraft(null)
    current = await saveDraft([entry])
    await expect(store.activationPlan("shirt", { ...input, ...current, confirmations: {} })).rejects.toThrow("Confirm")
  })
  it("upgrades proven equivalent historical bindings on save without blessing a changed design", async () => {
    const input = await save()
    await promote()
    const activated = await store.activate("shirt", input, actor, host)
    for (const column of ["draft_manifest", "active_manifest"])
      await pool.query(
        `update commerce.product_galleries set ${column}=jsonb_set(${column},'{colors,0,reviewedBinding,version}','"gallery-v1/old"')`
      )
    const next = galleryProductFixture()
    next.variants[0]!.price += 100
    await source(next, "2")
    const restored = await store.save(
      "shirt",
      { action: "restore", ...activated, productRevision: "1", fromRevision: activated.revision },
      actor,
      host
    )
    const state = await store.read("shirt")
    expect(galleryManifestSchema.parse(state.published).colors[0]!.reviewedBinding).toEqual(
      readGallerySource(next, "2").colors[0]!.binding
    )
    expect(await store.evidence("shirt", [state.published])).toEqual({})
    await pool.query(
      `update commerce.product_galleries set active_manifest=jsonb_set(active_manifest,'{colors,0,reviewedBinding,version}','"gallery-v1/old"')`
    )
    next.print_areas[0]!.placeholders[0]!.images[0]!.y = 0.9
    await source(next, "3")
    await store.save(
      "shirt",
      { action: "restore", ...restored, productRevision: "2", fromRevision: activated.revision },
      actor,
      host
    )
    expect(galleryManifestSchema.parse((await store.read("shirt")).published).colors[0]!.reviewedBinding?.version).toBe(
      "gallery-v1/old"
    )
  })
  it("serves galleries from the publishing store's request pool and shop", async () => {
    const input = await save()
    const publishing = new PostgresPublishingStore(url!, "123")
    try {
      expect(publishing.galleries).toBeInstanceOf(ProductGalleryStore)
      expect((await publishing.galleries.read("shirt")).revision).toBe(input.revision)
    } finally {
      await publishing.close()
    }
  })
  it("grants append-only server media access and denies browser access", async () => {
    await save()
    const client = await pool.connect()
    try {
      await client.query("begin;set local role authenticated")
      await expect(client.query("select * from commerce.product_gallery_assets")).rejects.toThrow("permission denied")
    } finally {
      await client.query("rollback")
      client.release()
    }
    await expect(runtime.query("delete from commerce.product_gallery_assets")).rejects.toThrow("permission denied")
    await expect(runtime.query("update commerce.product_gallery_promotions set host='bad'")).rejects.toThrow(
      "permission denied"
    )
  })
})
