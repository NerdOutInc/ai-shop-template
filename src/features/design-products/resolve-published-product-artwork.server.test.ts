// @vitest-environment node
import { randomUUID } from "node:crypto"
import type { Pool } from "pg"
import sharp from "sharp"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { inspectLibraryImage } from "@/features/design-library/inspect-library-image.server"

import { productArtworkFingerprint } from "./product-artwork-fingerprint"
import { readApprovedProductArtwork } from "./read-approved-product-artwork.server"
import { resolvePublishedProductArtwork } from "./resolve-published-product-artwork.server"

vi.mock("server-only", () => ({}))
vi.mock("@/features/admin/get-admin-database.server", () => ({ getAdminDatabase: vi.fn() }))
vi.mock("./read-approved-product-artwork.server", () => ({ readApprovedProductArtwork: vi.fn() }))

beforeEach(() => vi.mocked(readApprovedProductArtwork).mockResolvedValue(null))

async function setup() {
  const bytes = await sharp(Buffer.from([255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 255, 255, 0, 0, 0, 0]), {
    raw: { width: 2, height: 2, channels: 4 },
  })
    .png()
    .toBuffer()
  const inspected = await inspectLibraryImage(bytes)
  const row = {
    id: randomUUID(),
    revision_id: randomUUID(),
    canonical_design_id: randomUUID(),
    kind: "print",
    status: "ready",
    pathname: "concepts/private-master.png",
    source_path: null,
    original_filename: "approved.png",
    mime_type: "image/png",
    width: inspected.width,
    height: inspected.height,
    bytes: bytes.length,
    sha256: inspected.sha256,
    pixel_sha256: inspected.pixelSha256,
    has_alpha: true,
    has_transparency: true,
    enlarged: null,
    bound_revision: false,
    registered_revision: false,
  }
  const source: Record<string, unknown> = {
    id: "published-shirt",
    shop_id: 123,
    title: "Library artwork",
    blueprint_id: 1317,
    print_provider_id: 99,
    variants: [{ id: 101, price: 3000, is_enabled: true, is_available: true, options: [1] }],
    options: [{ values: [{ id: 1, title: "Black" }] }],
    print_areas: [
      {
        variant_ids: [101],
        placeholders: [
          {
            position: "front",
            decoration_method: "dtg",
            images: [
              {
                id: "original-upload",
                src: "https://images.printify.com/full-source.png",
                type: "image/png",
                layerType: "image",
                width: 2,
                height: 2,
                x: 0.5,
                y: 0.5,
                scale: 1,
                angle: 0,
              },
            ],
          },
        ],
      },
    ],
  }
  const matches = {
    library: [row],
    registry: [] as (typeof row)[],
    publication: [] as (typeof row & {
      snapshot: Record<string, unknown>
      snapshot_shop_id: string
      snapshot_product_id: string
    })[],
  }
  const query = vi.fn<(sql: string, values: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>>(
    async (sql) => ({
      rows: sql.includes("r.printify_image_id")
        ? matches.registry
        : sql.includes("from commerce.printify_products p")
          ? matches.publication
          : matches.library,
    })
  )
  const options = {
    database: { query } as unknown as Pool,
    readSource: vi.fn(async () => bytes),
    now: () => 0,
  }
  const input = () => ({
    shopId: "123",
    productId: "published-shirt",
    productionFingerprint: productArtworkFingerprint(source, { shopId: "123", productId: "published-shirt" })!,
    source,
    deadline: 30_000,
  })
  const areas = source.print_areas as {
    font_family?: string
    font_color?: string
    placeholders: { position: string; decoration_method: string; images: Record<string, unknown>[] }[]
  }[]
  return {
    bytes,
    row,
    inspected,
    source,
    query,
    matches,
    options,
    input,
    areas,
    image: areas[0]!.placeholders[0]!.images[0]!,
  }
}

async function savedPublication() {
  const fixture = await setup()
  const snapshot = {
    ...structuredClone(fixture.source),
    id: fixture.source.id,
    shop_id: fixture.source.shop_id,
    storefront_artwork_enabled: true,
    storefront_artwork: {
      src: `https://catalog.public.blob.vercel-storage.com/published-artwork/v1/${"a".repeat(64)}.webp`,
      sha256: "a".repeat(64),
      revisionId: fixture.row.revision_id,
      sourceSha256: fixture.row.sha256,
      productionFingerprint: fixture.input().productionFingerprint,
      width: 1,
      height: 1,
    },
  }
  fixture.matches.publication = [
    { ...fixture.row, snapshot, snapshot_shop_id: "123", snapshot_product_id: "published-shirt" },
  ]
  fixture.matches.library = []
  return { ...fixture, snapshot }
}

describe("published artwork exact library recovery", () => {
  it("recovers manually published library pixels without changing approvals, bindings, or readiness", async () => {
    const fixture = await setup()
    const result = await resolvePublishedProductArtwork(fixture.input(), fixture.options)
    expect(result).toMatchObject({
      revisionId: fixture.row.revision_id,
      productionFingerprint: fixture.input().productionFingerprint,
      printAsset: { id: fixture.row.id, sha256: fixture.inspected.sha256 },
    })
    expect(fixture.query).toHaveBeenNthCalledWith(3, expect.stringContaining("select a.*"), [
      "123",
      "published-shirt",
      fixture.inspected.pixelSha256,
      2,
      2,
    ])
    for (const [sql] of fixture.query.mock.calls)
      expect(sql).not.toMatch(/insert|update|print_readiness|current_revision_id/i)
  })

  it("keeps the exact registry authoritative without downloading the source again", async () => {
    const fixture = await setup()
    const registered = {
      revisionId: fixture.row.revision_id,
      productionFingerprint: fixture.input().productionFingerprint,
      printAsset: { id: fixture.row.id },
    } as Awaited<ReturnType<typeof readApprovedProductArtwork>>
    vi.mocked(readApprovedProductArtwork).mockResolvedValue(registered)
    expect(await resolvePublishedProductArtwork(fixture.input(), fixture.options)).toBe(registered)
    expect(fixture.options.readSource).not.toHaveBeenCalled()
    expect(fixture.query).not.toHaveBeenCalled()
  })

  it("recovers placement edits under the new fingerprint rather than reusing the draft fingerprint", async () => {
    const fixture = await setup()
    const old = fixture.input().productionFingerprint
    fixture.image.y = 0.43
    fixture.image.scale = 0.89
    fixture.matches.registry = [fixture.row]
    expect(fixture.input().productionFingerprint).not.toBe(old)
    expect(await resolvePublishedProductArtwork(fixture.input(), fixture.options)).toMatchObject({
      productionFingerprint: fixture.input().productionFingerprint,
    })
    expect(readApprovedProductArtwork).toHaveBeenCalledWith(fixture.input(), fixture.options.database)
    expect(fixture.options.readSource).not.toHaveBeenCalled()
  })

  it("refuses changed source identity before trusting even an old registry record", async () => {
    const fixture = await setup()
    const input = fixture.input()
    fixture.image.id = "changed-upload"
    await expect(resolvePublishedProductArtwork(input, fixture.options)).rejects.toMatchObject({
      code: "IMAGE_SOURCE_CHANGED",
      retryable: false,
    })
    expect(readApprovedProductArtwork).not.toHaveBeenCalled()
  })

  it.each(["front_dtg", "provider-font-defaults", "care-label"])("supports the published %s shape", async (shape) => {
    const fixture = await setup()
    const area = fixture.areas[0]!
    if (shape === "front_dtg") {
      area.placeholders[0]!.position = "front_dtg"
      area.placeholders.push({ position: "back_dtg", decoration_method: "dtg", images: [] })
    } else if (shape === "provider-font-defaults") {
      area.font_family = "Roboto"
      area.placeholders.push({ position: "neck_outer", decoration_method: "dtg", images: [] })
    } else {
      area.font_family = "Roboto"
      area.font_color = "auto"
      area.placeholders.push({
        position: "neck",
        decoration_method: "dtf",
        images: [{ id: "care", name: "text_layer.svg", type: "text/plain", x: 0.5, y: 0.5, scale: 1, angle: 0 }],
      })
    }
    expect(await resolvePublishedProductArtwork(fixture.input(), fixture.options)).not.toBeNull()
  })

  it("accepts unused Roboto/black defaults on PNG artwork", async () => {
    const fixture = await setup()
    fixture.areas[0]!.font_family = "Roboto"
    fixture.areas[0]!.font_color = "#000"
    expect(await resolvePublishedProductArtwork(fixture.input(), fixture.options)).not.toBeNull()
  })

  it.each(["layer", "back", "custom-font", "custom-text", "unsupported-print", "different-upload"])(
    "does not flatten or reinterpret %s artwork",
    async (shape) => {
      const fixture = await setup()
      const area = fixture.areas[0]!
      if (shape === "layer") area.placeholders[0]!.images.push({ ...fixture.image, id: "another-layer" })
      if (shape === "back")
        area.placeholders.push({ position: "back", decoration_method: "dtg", images: [fixture.image] })
      if (shape === "custom-font") area.font_family = "Custom font"
      if (shape === "custom-text") {
        area.font_family = "Roboto"
        area.font_color = "#000"
        fixture.image.input_text = "Custom neck label"
      }
      if (shape === "unsupported-print") area.placeholders[0]!.decoration_method = "embroidery"
      if (shape === "different-upload")
        fixture.areas.push({
          placeholders: [{ ...area.placeholders[0]!, images: [{ ...fixture.image, id: "second" }] }],
        })
      expect(await resolvePublishedProductArtwork(fixture.input(), fixture.options)).toBeNull()
      expect(fixture.options.readSource).not.toHaveBeenCalled()
    }
  )

  it.each(["opaque", "blank", "jpeg", "wrong-size"])("does not accept %s source claims", async (kind) => {
    const fixture = await setup()
    const image = sharp({
      create: {
        width: kind === "wrong-size" ? 3 : 2,
        height: 2,
        channels: 4,
        background: kind === "blank" ? "#00000000" : "#ff0000",
      },
    })
    const bytes =
      kind === "jpeg"
        ? await image.jpeg().toBuffer()
        : kind === "wrong-size"
          ? await sharp(fixture.bytes).resize(3, 2).png().toBuffer()
          : await image.png().toBuffer()
    fixture.options.readSource.mockResolvedValue(bytes)
    expect(await resolvePublishedProductArtwork(fixture.input(), fixture.options)).toBeNull()
    expect(fixture.query).toHaveBeenCalledTimes(2)
  })

  it("leaves missing and ambiguous library matches without a preview", async () => {
    const fixture = await setup()
    fixture.matches.library = []
    expect(await resolvePublishedProductArtwork(fixture.input(), fixture.options)).toBeNull()
    fixture.matches.library = [fixture.row, { ...fixture.row, id: randomUUID(), revision_id: randomUUID() }]
    expect(await resolvePublishedProductArtwork(fixture.input(), fixture.options)).toBeNull()
    fixture.matches.library = [fixture.row, { ...fixture.row, canonical_design_id: randomUUID(), bound_revision: true }]
    expect(await resolvePublishedProductArtwork(fixture.input(), fixture.options)).toBeNull()
  })

  it.each(["bound_revision", "registered_revision"])(
    "uses exact %s evidence to disambiguate copied pixels",
    async (evidence) => {
      const fixture = await setup()
      const expected = { ...fixture.row, id: randomUUID(), revision_id: randomUUID(), [evidence]: true }
      fixture.matches.library = [fixture.row, expected]
      expect(await resolvePublishedProductArtwork(fixture.input(), fixture.options)).toMatchObject({
        revisionId: expected.revision_id,
      })
    }
  )

  it("refuses a downsized provider preview even if it happens to match a smaller library image", async () => {
    const fixture = await setup()
    fixture.image.width = 4000
    fixture.image.height = 4000
    expect(await resolvePublishedProductArtwork(fixture.input(), fixture.options)).toBeNull()
    expect(fixture.query).toHaveBeenCalledTimes(2)
  })

  it("reuses an immutable upload on another garment without trusting its thumbnail", async () => {
    const fixture = await setup()
    fixture.source.blueprint_id = 1312
    fixture.matches.registry = [fixture.row]
    fixture.options.readSource.mockRejectedValue(new Error("Thumbnail is not an original"))
    expect(await resolvePublishedProductArtwork(fixture.input(), fixture.options)).toMatchObject({
      revisionId: fixture.row.revision_id,
    })
    expect(fixture.options.readSource).not.toHaveBeenCalled()
  })

  it.each(["dimensions", "conflicting-pixels"])(
    "does not trust an upload receipt with %s disagreement",
    async (kind) => {
      const fixture = await setup()
      fixture.matches.registry = [fixture.row]
      if (kind === "dimensions") fixture.image.width = 4000
      else fixture.matches.registry.push({ ...fixture.row, pixel_sha256: "b".repeat(64) })
      expect(await resolvePublishedProductArtwork(fixture.input(), fixture.options)).toBeNull()
      expect(fixture.options.readSource).not.toHaveBeenCalled()
    }
  )

  it("retries temporary source failures rather than silently publishing without known artwork", async () => {
    const fixture = await setup()
    fixture.options.readSource.mockRejectedValue(new Error("provider unavailable"))
    await expect(resolvePublishedProductArtwork(fixture.input(), fixture.options)).rejects.toMatchObject({
      code: "IMAGE_SOURCE_UNAVAILABLE",
      retryable: true,
    })
  })

  it("bounds a source adapter that stalls without honoring its AbortSignal", async () => {
    const fixture = await setup()
    const controller = new AbortController()
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal)
    fixture.options.readSource.mockImplementation(() => new Promise(() => {}))
    const result = resolvePublishedProductArtwork(fixture.input(), fixture.options)
    const assertion = expect(result).rejects.toMatchObject({ code: "IMAGE_SOURCE_UNAVAILABLE", retryable: true })
    await vi.waitFor(() => expect(fixture.options.readSource).toHaveBeenCalled())
    controller.abort(new DOMException("Deadline reached", "TimeoutError"))
    await assertion
  })

  it("stops when no source-processing budget remains", async () => {
    const fixture = await setup()
    await expect(
      resolvePublishedProductArtwork({ ...fixture.input(), deadline: 1000 }, fixture.options)
    ).rejects.toMatchObject({
      code: "IMAGE_SOURCE_UNAVAILABLE",
      retryable: true,
    })
    expect(fixture.options.readSource).not.toHaveBeenCalled()
  })

  it.each([false, true])("keeps a proven saved publication when placement changes: %s", async (placementChanged) => {
    const fixture = await savedPublication()
    if (placementChanged) fixture.image.y = 0.42
    expect(await resolvePublishedProductArtwork(fixture.input(), fixture.options)).toMatchObject({
      revisionId: fixture.row.revision_id,
      productionFingerprint: fixture.input().productionFingerprint,
      printAsset: { id: fixture.row.id, sha256: fixture.row.sha256 },
    })
    expect(fixture.options.readSource).not.toHaveBeenCalled()
    expect(fixture.query).toHaveBeenNthCalledWith(2, expect.stringContaining("p.snapshot is not null"), [
      "123",
      "original-upload",
    ])
  })

  it.each([false, true])("reuses a verified pin across garments with black defaults: %s", async (defaults) => {
    const fixture = await savedPublication()
    if (defaults) {
      const areas = (fixture.snapshot as Record<string, unknown>).print_areas as typeof fixture.areas
      areas[0]!.font_family = "Roboto"
      areas[0]!.font_color = "#000"
      fixture.snapshot.storefront_artwork.productionFingerprint = productArtworkFingerprint(fixture.snapshot, {
        shopId: "123",
        productId: "published-shirt",
      })!
    }
    const source = { ...structuredClone(fixture.source), id: "new-crop", blueprint_id: 1312 }
    const input = {
      ...fixture.input(),
      productId: "new-crop",
      source,
      productionFingerprint: productArtworkFingerprint(source, { shopId: "123", productId: "new-crop" })!,
    }
    fixture.options.readSource.mockRejectedValue(new Error("Only a thumbnail is available"))
    expect(await resolvePublishedProductArtwork(input, fixture.options)).toMatchObject({
      revisionId: fixture.row.revision_id,
      productionFingerprint: input.productionFingerprint,
      printAsset: { id: fixture.row.id },
    })
    expect(input.productionFingerprint).not.toBe(fixture.snapshot.storefront_artwork.productionFingerprint)
    expect(fixture.options.readSource).not.toHaveBeenCalled()
    expect(fixture.query).toHaveBeenNthCalledWith(2, expect.stringContaining("jsonb_build_object('id',$2::text)"), [
      "123",
      "original-upload",
    ])
    const sql = fixture.query.mock.calls[1]![0]
    expect(sql).toContain("p.shop_id=$1")
    expect(sql).toContain("limit 101")
    expect(sql).not.toMatch(/\bp\.active\b|\bp\.hidden_at\b/)
  })

  it("deduplicates the same exact pin across products and ignores invalid neighboring evidence", async () => {
    const fixture = await savedPublication()
    const another = { ...structuredClone(fixture.snapshot), id: "another-shirt" }
    another.storefront_artwork.productionFingerprint = productArtworkFingerprint(another, {
      shopId: "123",
      productId: "another-shirt",
    })!
    fixture.matches.publication.push(
      { ...fixture.matches.publication[0]!, snapshot: another, snapshot_product_id: "another-shirt" },
      { ...fixture.matches.publication[0]!, snapshot_shop_id: "another-shop" },
      { ...fixture.matches.publication[0]!, snapshot_product_id: "forged-product" }
    )
    expect(await resolvePublishedProductArtwork(fixture.input(), fixture.options)).toMatchObject({
      revisionId: fixture.row.revision_id,
    })
    expect(fixture.options.readSource).not.toHaveBeenCalled()
  })

  it("refuses conflicting valid pinned revisions instead of choosing a product or fetching its thumbnail", async () => {
    const fixture = await savedPublication()
    const revisionId = randomUUID()
    const another = { ...structuredClone(fixture.snapshot), id: "another-shirt" }
    another.storefront_artwork.revisionId = revisionId
    another.storefront_artwork.productionFingerprint = productArtworkFingerprint(another, {
      shopId: "123",
      productId: "another-shirt",
    })!
    fixture.matches.publication.push({
      ...fixture.row,
      id: randomUUID(),
      revision_id: revisionId,
      snapshot: another,
      snapshot_shop_id: "123",
      snapshot_product_id: "another-shirt",
    })
    expect(await resolvePublishedProductArtwork(fixture.input(), fixture.options)).toBeNull()
    expect(fixture.options.readSource).not.toHaveBeenCalled()
  })

  it("refuses an incomplete saved-pin candidate set", async () => {
    const fixture = await savedPublication()
    fixture.matches.publication = Array.from({ length: 101 }, () => fixture.matches.publication[0]!)
    expect(await resolvePublishedProductArtwork(fixture.input(), fixture.options)).toBeNull()
    expect(fixture.options.readSource).not.toHaveBeenCalled()
  })

  it.each([
    "upload",
    "stale-fingerprint",
    "source-hash",
    "revision",
    "disabled",
    "dimensions",
    "product",
    "shop",
    "invalid-pin",
  ])("does not reuse a publication with a mismatched %s", async (mismatch) => {
    const fixture = await savedPublication()
    if (mismatch === "upload") fixture.image.id = "replacement-upload"
    if (mismatch === "stale-fingerprint")
      fixture.snapshot.storefront_artwork.productionFingerprint = `artwork-v1:${"b".repeat(64)}`
    if (mismatch === "source-hash") fixture.snapshot.storefront_artwork.sourceSha256 = "b".repeat(64)
    if (mismatch === "revision") fixture.snapshot.storefront_artwork.revisionId = randomUUID()
    if (mismatch === "disabled") fixture.snapshot.storefront_artwork_enabled = false
    if (mismatch === "dimensions") fixture.image.width = 3000
    if (mismatch === "product") fixture.snapshot.id = "neighbor-product"
    if (mismatch === "shop") fixture.snapshot.shop_id = 999
    if (mismatch === "invalid-pin") fixture.snapshot.storefront_artwork.src = "/api/admin/assets/private-master"
    delete fixture.image.src
    expect(await resolvePublishedProductArtwork(fixture.input(), fixture.options)).toBeNull()
    expect(fixture.options.readSource).not.toHaveBeenCalled()
  })

  it("does not reuse a pin whose old snapshot has unsupported additional artwork", async () => {
    const fixture = await savedPublication()
    const oldAreas = (fixture.snapshot as Record<string, unknown>).print_areas as typeof fixture.areas
    oldAreas[0]!.placeholders.push({ position: "back", decoration_method: "dtg", images: [{ ...fixture.image }] })
    fixture.snapshot.storefront_artwork.productionFingerprint = productArtworkFingerprint(
      fixture.snapshot,
      fixture.input()
    )!
    delete fixture.image.src
    expect(await resolvePublishedProductArtwork(fixture.input(), fixture.options)).toBeNull()
    expect(fixture.options.readSource).not.toHaveBeenCalled()
  })

  it("keeps unavailable provenance queries retryable", async () => {
    const fixture = await setup()
    fixture.query.mockRejectedValue(new Error("Database connection unavailable"))
    await expect(resolvePublishedProductArtwork(fixture.input(), fixture.options)).rejects.toMatchObject({
      code: "IMAGE_RECEIPT_UNAVAILABLE",
      retryable: true,
    })
  })
})
