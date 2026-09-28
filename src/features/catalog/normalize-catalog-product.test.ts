import { describe, expect, it } from "vitest"

import { catalogProductSchema } from "./catalog-product-schema"
import { normalizeCatalogProduct } from "./normalize-catalog-product"

function fixture() {
  return {
    id: "shirt",
    shop_id: 123,
    title: "Good hangs",
    description: "A tee.",
    variants: [
      { id: 1, price: 2500, is_enabled: true, is_available: true, options: [10] },
      { id: 2, price: 2500, is_enabled: true, is_available: false, options: [20] },
      { id: 3, price: 2500, is_enabled: false, is_available: true, options: [30] },
    ],
    options: [
      {
        name: "Colors",
        type: "color",
        values: [
          { id: 10, title: "Grey", colors: ["#888888"] },
          { id: 20, title: "Green", colors: ["#126644"] },
          { id: 30, title: "Blue", colors: ["#123456"] },
        ],
      },
    ],
    images: [
      { src: "https://images.printify.com/grey.jpg", variant_ids: [1], is_default: false },
      { src: "https://images.printify.com/green-back.jpg", variant_ids: [2], is_default: false },
      { src: "https://images.printify.com/green.jpg", variant_ids: [2], is_default: true },
    ],
  }
}

describe("normalizeCatalogProduct", () => {
  it("does not invent artwork for a product without approved publication provenance", () => {
    const raw = fixture()
    expect(normalizeCatalogProduct(raw).artwork).toBeNull()
    expect(normalizeCatalogProduct({ ...raw, storefront_artwork_enabled: true }).artwork).toBeNull()
  })

  it("renders only the snapshot-owned public preview and strips private artwork provenance", () => {
    const artwork = {
      src: `https://catalog.public.blob.vercel-storage.com/published-artwork/v1/${"a".repeat(64)}.webp`,
      revisionId: "34d7df72-f329-45f9-acd5-faa4a0c10e25",
      productionFingerprint: `artwork-v1:${"b".repeat(64)}`,
      width: 960,
      height: 1200,
      privateAssetId: "private-asset",
      sourceSha256: "private-source-hash",
    }
    const product = normalizeCatalogProduct({
      ...fixture(),
      storefront_artwork_enabled: true,
      storefront_artwork: artwork,
    })
    expect(product.artwork).toEqual({ src: artwork.src, alt: "Good hangs artwork", backgroundColor: "#126644" })
    expect(JSON.stringify(product)).not.toMatch(/revisionId|productionFingerprint|privateAssetId|private-source-hash/)
  })

  it.each([
    "/api/admin/assets/private",
    "https://art.private.blob.vercel-storage.com/master.png",
    "https://art.public.blob.vercel-storage.com/concepts/master.png",
    "https://attacker.example/art.webp",
  ])("hides invalid attached artwork %s without dropping the product", (src) => {
    const product = normalizeCatalogProduct({
      ...fixture(),
      storefront_artwork: {
        src,
        revisionId: "34d7df72-f329-45f9-acd5-faa4a0c10e25",
        productionFingerprint: `artwork-v1:${"b".repeat(64)}`,
        width: 960,
        height: 1200,
      },
    })
    expect(product.artwork).toBeNull()
    expect(product.title).toBe("Good hangs")
  })

  it("keeps recovery provenance in the private snapshot and strips it from public catalog images", () => {
    const source = fixture()
    const raw = {
      ...source,
      images: source.images.map((image, index) => ({
        ...image,
        src: `https://catalog.public.blob.vercel-storage.com/published-mockups/v1/${String(index).repeat(64)}.jpg`,
        source_src: `https://images-api.printify.com/mockup/private-${index}.jpg?internal=source-only`,
      })),
    }
    const privateSnapshot = structuredClone(raw)
    const parsed = catalogProductSchema.parse(raw)
    expect(parsed.images).toEqual(
      raw.images.map(({ src, variant_ids, is_default }) => ({ src, variant_ids, is_default }))
    )
    const product = normalizeCatalogProduct(raw)
    expect(product.image).toEqual({ src: raw.images[2]!.src, alt: raw.title })
    expect(product.images).toEqual([
      { src: raw.images[2]!.src, alt: raw.title, variantIds: [2] },
      { src: raw.images[0]!.src, alt: raw.title, variantIds: [1] },
      { src: raw.images[1]!.src, alt: raw.title, variantIds: [2] },
    ])
    expect(JSON.stringify(product)).not.toContain("source_src")
    expect(JSON.stringify(product)).not.toContain("images-api.printify.com")
    expect(raw).toEqual(privateSnapshot)
  })

  it("uses Primary for the card, first gallery photo, and default color regardless of availability or array order", () => {
    const product = normalizeCatalogProduct(fixture())
    expect(product.image?.src).toBe("https://images.printify.com/green.jpg")
    expect(product.images[0]?.src).toBe(product.image?.src)
    expect(product.defaultColor).toBe("Green")
    expect(product.variants.find((variant) => variant.color === product.defaultColor)?.available).toBe(false)
  })

  it("preserves distinct camera views across colors and Primary ordering without exposing hosted photo provenance", () => {
    const source = fixture()
    const images = [
      { color: "grey", variant: 1, camera: "front", primary: false },
      { color: "grey", variant: 1, camera: "person-1-front", primary: false },
      { color: "green", variant: 2, camera: "front", primary: false },
      { color: "green", variant: 2, camera: "person-1-front", primary: true },
    ].map(({ color, variant, camera, primary }, index) => ({
      src: `https://catalog.public.blob.vercel-storage.com/published-mockups/v1/${String(index).repeat(64)}.jpg`,
      source_src: `https://images-api.printify.com/mockup/shirt/${color}/camera/tee.jpg?camera_label=${camera}&internal=private-recovery`,
      variant_ids: [variant],
      is_default: primary,
    }))
    const raw = { ...source, images }
    const parsed = catalogProductSchema.parse(raw)
    const product = normalizeCatalogProduct(parsed)
    expect(product.images.map(({ variantIds, viewKey }) => ({ variantIds, viewKey }))).toEqual([
      { variantIds: [2], viewKey: "person-1-front" },
      { variantIds: [1], viewKey: "front" },
      { variantIds: [1], viewKey: "person-1-front" },
      { variantIds: [2], viewKey: "front" },
    ])
    expect(product.image).toMatchObject({ src: images[3]!.src, viewKey: "person-1-front" })
    expect(JSON.stringify(parsed)).not.toMatch(/source_src|images-api\.printify\.com|private-recovery/)
    expect(JSON.stringify(product)).not.toMatch(/source_src|images-api\.printify\.com|private-recovery/)
    expect(normalizeCatalogProduct(raw)).toEqual(product)
  })

  it("reads the exact camera view from a direct Printify mockup", () => {
    const raw = fixture()
    raw.images[2]!.src = "https://images-api.printify.com/mockup/shirt/2/3/tee.jpg?camera_label=person-1-front"
    expect(normalizeCatalogProduct(raw).image?.viewKey).toBe("person-1-front")
  })

  it.each([
    "https://attacker.example/mockup/tee.jpg?camera_label=front",
    "https://images-api.printify.com/api/file/private.png?camera_label=front",
    "https://private:token@images-api.printify.com/mockup/tee.jpg?camera_label=front",
    "not-a-url",
    "https://images-api.printify.com/mockup/tee.jpg?camera_label=https%3A%2F%2Fprivate.example",
    `https://images-api.printify.com/mockup/tee.jpg?camera_label=${"a".repeat(81)}`,
  ])("keeps a photo usable without treating malformed or untrusted camera metadata as a view: %s", (source_src) => {
    const raw = fixture()
    const product = normalizeCatalogProduct({
      ...raw,
      images: raw.images.map((image) => ({ ...image, source_src, view_key: { invalid: true } })),
    })
    expect(product.images).toHaveLength(3)
    expect(product.images.every((image) => image.viewKey === undefined)).toBe(true)
    expect(product.image).not.toHaveProperty("viewKey")
  })

  it.each([{ variantIds: [3] }, { variantIds: [999] }, { variantIds: [] }])(
    "uses the same eligible fallback for an unlinked Primary (%j)",
    ({ variantIds }) => {
      const raw = fixture()
      raw.images[2]!.variant_ids = variantIds
      const product = normalizeCatalogProduct(raw)
      expect(product.image?.src).toBe("https://images.printify.com/grey.jpg")
      expect(product.images[0]?.src).toBe(product.image?.src)
      expect(product.defaultColor).toBe("Grey")
    }
  )

  it("chooses a deterministic linked color for an ambiguous primary image", () => {
    const raw = fixture()
    raw.images[2]!.variant_ids = [2, 1]
    expect(normalizeCatalogProduct(raw).defaultColor).toBe("Grey")
    raw.images[2]!.variant_ids = [1, 2]
    expect(normalizeCatalogProduct(raw).defaultColor).toBe("Grey")
  })

  it("changes the image and default color together when the published Primary changes", () => {
    const raw = fixture()
    const original = normalizeCatalogProduct(raw)
    const changed = normalizeCatalogProduct({
      ...raw,
      images: raw.images.map((image, index) => ({ ...image, is_default: index === 0 })),
    })
    expect([original.defaultColor, changed.defaultColor]).toEqual(["Green", "Grey"])
    expect(changed.image?.src).toBe("https://images.printify.com/grey.jpg")
  })

  it("keeps published mockups when a preview has been disabled", () => {
    const product = normalizeCatalogProduct({
      ...fixture(),
      id: "111111000000000000000002",
      storefront_artwork_enabled: false,
    })
    expect(product.artwork).toBeNull()
    expect(product.image?.src).toBe("https://images.printify.com/green.jpg")
    expect(product.images[0]?.src).toBe(product.image?.src)
    expect(product.defaultColor).toBe("Green")
  })

  it("reads the arrival the storefront projection settled, as an ISO timestamp", () => {
    expect(
      normalizeCatalogProduct({ ...fixture(), storefront_added_to_shop_at: "2026-09-14T12:00:00.000Z" }).addedToShopAt
    ).toBe("2026-09-14T12:00:00.000Z")
    expect(
      normalizeCatalogProduct({ ...fixture(), storefront_added_to_shop_at: "2026-09-14T08:00:00-04:00" }).addedToShopAt
    ).toBe("2026-09-14T12:00:00.000Z")
  })

  // Newest means newest in the shop. Printify's created_at is when the draft was made, which can be
  // weeks before the owner showed it, so a raw snapshot must not pass it off as an arrival.
  it("has no arrival for a raw Printify snapshot, whatever its created_at says", () => {
    expect(normalizeCatalogProduct(fixture()).addedToShopAt).toBeNull()
    expect(normalizeCatalogProduct({ ...fixture(), created_at: "2026-09-01 10:00:00+00:00" }).addedToShopAt).toBeNull()
  })

  it.each([null, "", "not-a-date", 1757851200000, { at: "2026-09-14" }])(
    "reads the unusable arrival %j as none without dropping the product",
    (storefront_added_to_shop_at) => {
      const product = normalizeCatalogProduct({ ...fixture(), storefront_added_to_shop_at })
      expect(product.addedToShopAt).toBeNull()
      expect(product.title).toBe("Good hangs")
    }
  )

  it("validates a candidate snapshot rather than silently accepting a malformed variant", () => {
    expect(() => normalizeCatalogProduct({ ...fixture(), variants: [{ id: 1, price: "free" }] })).toThrow()
  })
})
