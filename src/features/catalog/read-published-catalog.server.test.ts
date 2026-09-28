import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { readCatalogStock } from "@/features/catalog-sync/read-catalog-stock.server"
import type { GarmentDisplayProfile } from "@/features/garment-catalog/garment-catalog"
import { listGarmentDisplayProfiles } from "@/features/garment-catalog/list-garment-display-profiles.server"
import { parsePrintifyProduct } from "@/lib/printify/parse-printify-product"

import { catalogProductSchema } from "./catalog-product-schema"
import { readPublishedCatalog } from "./read-published-catalog.server"

vi.mock("server-only", () => ({}))
vi.mock("@/features/catalog-sync/read-catalog-stock.server", () => ({ readCatalogStock: vi.fn() }))
vi.mock("@/features/garment-catalog/list-garment-display-profiles.server", () => ({
  listGarmentDisplayProfiles: vi.fn(),
}))
const observedProduct = vi.fn<() => Promise<Response>>()
const fetchMock = vi.fn<typeof fetch>()
function fixture(id = "shirt") {
  return {
    id,
    shop_id: 123,
    title: "Published tee",
    description: "Published description",
    blueprint_id: 1317,
    print_provider_id: 99,
    print_areas: [
      {
        variant_ids: [1, 2, 3],
        placeholders: [{ position: "front", images: [{ id: "private-artwork", x: 0.5, y: 0.5, scale: 1, angle: 0 }] }],
      },
    ],
    variants: [
      { id: 1, price: 2500, is_enabled: true, is_available: false, options: [10] },
      { id: 2, price: 2800, is_enabled: true, is_available: true, options: [20] },
      { id: 3, price: 3000, is_enabled: false, is_available: true, options: [30] },
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
      { src: "https://images.printify.com/green.jpg", variant_ids: [2], is_default: true },
    ],
  }
}

beforeEach(() => {
  fetchMock.mockReset()
  observedProduct.mockReset()
  vi.mocked(listGarmentDisplayProfiles).mockResolvedValue(new Map())
  vi.mocked(readCatalogStock).mockImplementation(async () => {
    try {
      const raw = await (await observedProduct()).json()
      const current = parsePrintifyProduct(raw, { productId: "shirt", shopId: "123" })
      return current ? { shirt: current.variants } : null
    } catch {
      return null
    }
  })
  vi.stubGlobal("fetch", fetchMock)
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
  vi.spyOn(console, "error").mockImplementation(() => undefined)
})
afterEach(() => {
  expect(fetchMock).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("readPublishedCatalog", () => {
  it("matches each published blueprint to its own saved garment, including cached display projections", async () => {
    const profiles = new Map<number, GarmentDisplayProfile>([
      [
        1312,
        {
          manufacturer: "Next Level",
          model: "5080",
          categoryName: "Crop tops",
          categorySortPosition: 3,
          categorySlug: "crop-tops",
          gender: "female",
        },
      ],
      [
        1317,
        {
          manufacturer: "Next Level",
          model: "6210",
          categoryName: "T-shirts",
          categorySortPosition: 1,
          categorySlug: "t-shirts",
          gender: "unisex",
        },
      ],
      [
        2679,
        {
          manufacturer: "Stanley/Stella",
          model: "SASW035",
          categoryName: "Sweatshirts",
          categorySortPosition: 2,
          categorySlug: "sweatshirts",
          gender: "female",
        },
      ],
    ])
    vi.mocked(listGarmentDisplayProfiles).mockResolvedValue(profiles)
    const snapshots = [...profiles.keys()].map((blueprint_id) => {
      const raw = { ...fixture(`product-${blueprint_id}`), blueprint_id }
      const display = catalogProductSchema.parse(raw)
      const production = parsePrintifyProduct(raw, { productId: raw.id, shopId: String(raw.shop_id) })!
      return {
        ...display,
        variants: display.variants.map((variant) => ({
          ...variant,
          storefront_production_fingerprint: production.variants.find((entry) => entry.id === variant.id)!.fingerprint,
        })),
      }
    })
    const result = await readPublishedCatalog(snapshots)
    expect(result.status).toBe("ready")
    expect(result.products.map((product) => product.garment)).toEqual([...profiles.values()])
    expect(listGarmentDisplayProfiles).toHaveBeenCalledTimes(1)
  })

  it.each([undefined, null, "1317", 13.17])(
    "rejects a full publication with invalid production blueprint %s",
    async (blueprint_id) => {
      expect(await readPublishedCatalog([{ ...fixture(), blueprint_id }])).toEqual({
        status: "unavailable",
        products: [],
      })
    }
  )

  it.each([0, -1, 2_147_483_648, 9999])(
    "keeps an unmatched blueprint %s without borrowing another garment's label",
    async (blueprint_id) => {
      vi.mocked(listGarmentDisplayProfiles).mockResolvedValue(
        new Map([
          [
            1317,
            {
              manufacturer: "Next Level",
              model: "6210",
              categoryName: "T-shirts",
              categorySortPosition: 1,
              categorySlug: "t-shirts",
              gender: "unisex",
            },
          ],
        ])
      )
      const result = await readPublishedCatalog([{ ...fixture(), blueprint_id }])
      expect(result.status).toBe("ready")
      expect(result.products[0]?.garment).toBeNull()
    }
  )

  it("preserves product availability when saved garment profiles cannot be read", async () => {
    const published = fixture()
    observedProduct.mockResolvedValue(Response.json(published))
    vi.mocked(listGarmentDisplayProfiles).mockResolvedValue(null)
    const result = await readPublishedCatalog([published])
    expect(result).toMatchObject({ status: "ready", products: [{ garment: null, availability: "available" }] })
    expect(result.products[0]?.variants.find((variant) => variant.id === 2)?.available).toBe(true)
  })

  it("keeps published artwork A after the live draft changes to B, while pausing affected purchases", async () => {
    const artwork = {
      src: `https://catalog.public.blob.vercel-storage.com/published-artwork/v1/${"a".repeat(64)}.webp`,
      revisionId: "34d7df72-f329-45f9-acd5-faa4a0c10e25",
      productionFingerprint: `artwork-v1:${"b".repeat(64)}`,
      width: 960,
      height: 1200,
    }
    const published = { ...fixture(), storefront_artwork_enabled: true, storefront_artwork: artwork }
    const live = structuredClone(published)
    live.print_areas[0]!.placeholders[0]!.images[0]!.id = "private-draft-B"
    live.storefront_artwork.src = "https://private.private.blob.vercel-storage.com/secret-master.png"
    observedProduct.mockResolvedValue(Response.json(live))
    const product = (await readPublishedCatalog([published])).products[0]!
    expect(product.artwork?.src).toBe(artwork.src)
    expect(product.variants.every((variant) => !variant.available)).toBe(true)
    expect(JSON.stringify(product)).not.toMatch(/private-draft|secret-master|revisionId|productionFingerprint/)
    expect(published.storefront_artwork).toEqual(artwork)
  })

  it("keeps draft titles, prices, enabled variants, options, and mockups private while refreshing stock", async () => {
    const published = fixture()
    observedProduct.mockResolvedValue(
      Response.json({
        ...published,
        title: "Secret draft title",
        description: "Secret draft description",
        images: [],
        options: [],
        variants: published.variants.map((variant) => ({
          ...variant,
          price: 1,
          is_enabled: variant.id !== 2,
          is_available: variant.id !== 2,
        })),
      })
    )
    const result = await readPublishedCatalog([published])
    expect(result).toMatchObject({
      status: "ready",
      products: [
        {
          title: "Published tee",
          description: "Published description",
          defaultColor: "Green",
          image: { src: "https://images.printify.com/green.jpg" },
          price: { min: 2500, max: 2500 },
          variants: [
            { id: 1, price: 2500, available: true },
            { id: 2, price: 2800, available: false },
          ],
          options: [{ name: "Colors", values: ["Grey"] }],
        },
      ],
    })
    expect(result.products[0]?.variants).toHaveLength(2)
    expect(published.variants[0]?.is_available).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([false, undefined])(
    "retains the published Primary and colors but pauses display availability when live enabled is %s",
    async (enabled) => {
      const published = fixture()
      observedProduct.mockResolvedValue(
        Response.json({
          ...published,
          variants: published.variants.map((variant) => ({
            ...variant,
            is_available: true,
            is_enabled: variant.id === 2 ? enabled : true,
          })),
        })
      )
      const product = (await readPublishedCatalog([published])).products[0]!
      expect(product.defaultColor).toBe("Green")
      expect(product.image?.src).toBe("https://images.printify.com/green.jpg")
      expect(product.colors.map((color) => color.name)).toEqual(["Grey", "Green"])
      expect(
        product.variants.map((variant) => ({ id: variant.id, available: variant.available, price: variant.price }))
      ).toEqual([
        { id: 1, available: enabled !== undefined, price: 2500 },
        { id: 2, available: false, price: 2800 },
      ])
      expect(product.price).toEqual(enabled === undefined ? null : { currency: "USD", min: 2500, max: 2500 })
    }
  )

  it.each(["request", "different-shop", "different-product", "invalid-stock"])(
    "keeps the published listing but fails closed for %s stock failure",
    async (scenario) => {
      const live = fixture()
      if (scenario === "request") observedProduct.mockRejectedValue(new Error("private-token"))
      if (scenario === "different-shop") observedProduct.mockResolvedValue(Response.json({ ...live, shop_id: 456 }))
      if (scenario === "different-product") observedProduct.mockResolvedValue(Response.json({ ...live, id: "other" }))
      if (scenario === "invalid-stock")
        observedProduct.mockResolvedValue(Response.json({ ...live, variants: [{ id: 1, is_available: "yes" }] }))
      const result = await readPublishedCatalog([fixture()])
      expect(result.products[0]).toMatchObject({
        title: "Published tee",
        defaultColor: "Green",
        availability: "unavailable",
        price: null,
      })
      expect(result.products[0]?.variants.every((variant) => !variant.available)).toBe(true)
      expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("private-token")
    }
  )

  it("keeps persisted ordering without provider reads", async () => {
    const result = await readPublishedCatalog([fixture("second"), fixture("first")])
    expect(result.products.map((product) => product.id)).toEqual(["second", "first"])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("does not require credentials or live reads for an empty published catalog", async () => {
    expect(await readPublishedCatalog([])).toEqual({ status: "empty", products: [] })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects invalid snapshots without using live draft data as a fallback", async () => {
    expect(await readPublishedCatalog([{ id: "shirt" }])).toEqual({ status: "unavailable", products: [] })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("pauses only the variant whose unpublished production identity changed", async () => {
    const published = fixture()
    const live = fixture()
    live.variants.forEach((variant) => {
      variant.is_available = true
    })
    Object.assign(live.variants[0]!, { sku: "unpublished-sku-change" })
    observedProduct.mockResolvedValue(Response.json(live))
    const product = (await readPublishedCatalog([published])).products[0]!
    expect(product.variants.map((variant) => ({ id: variant.id, available: variant.available }))).toEqual([
      { id: 1, available: false },
      { id: 2, available: true },
    ])
    expect(product.description).toBe("Published description")
    expect(product.price).toEqual({ currency: "USD", min: 2800, max: 2800 })
    expect(JSON.stringify(product)).not.toMatch(/fingerprint|unpublished-sku-change|private-artwork/)
    expect(console.warn).toHaveBeenCalledExactlyOnceWith("Published product purchase availability paused", {
      code: "PUBLISHED_PRODUCTION_UNAVAILABLE",
      productId: "shirt",
      missingProductionVariantCount: 0,
      fingerprintMismatchVariantCount: 1,
    })
  })

  it("pauses affected options after an unpublished artwork change while retaining published photos", async () => {
    const published = fixture()
    const live = fixture()
    live.print_areas[0]!.placeholders[0]!.images[0]!.scale = 0.8
    live.variants.forEach((variant) => {
      variant.is_available = true
    })
    observedProduct.mockResolvedValue(Response.json(live))
    const product = (await readPublishedCatalog([published])).products[0]!
    expect(product.variants.every((variant) => !variant.available)).toBe(true)
    expect(product.image?.src).toBe("https://images.printify.com/green.jpg")
    expect(product.colors).toHaveLength(2)
    expect(console.warn).toHaveBeenCalledExactlyOnceWith("Published product purchase availability paused", {
      code: "PUBLISHED_PRODUCTION_UNAVAILABLE",
      productId: "shirt",
      missingProductionVariantCount: 0,
      fingerprintMismatchVariantCount: 2,
    })
  })

  it("does not pause a published offer because of a saved draft price or display-only change", async () => {
    const live = fixture()
    live.title = "Private draft title"
    live.images = []
    live.variants.forEach((variant) => {
      variant.price = 0
      variant.is_available = true
    })
    observedProduct.mockResolvedValue(Response.json(live))
    const product = (await readPublishedCatalog([fixture()])).products[0]!
    expect(product.variants.every((variant) => variant.available)).toBe(true)
    expect(product.price).toEqual({ currency: "USD", min: 2500, max: 2800 })
    expect(product.title).toBe("Published tee")
    expect(product.image?.src).toBe("https://images.printify.com/green.jpg")
  })

  it.each([undefined, "v1:older-schema", "invalid-current-shape"])(
    "rejects a display projection without current production fingerprints: %s",
    async (fingerprint) => {
      const raw = fixture()
      const projection = catalogProductSchema.parse(raw)
      const snapshot = {
        ...projection,
        variants: projection.variants.map((variant) => ({
          ...variant,
          storefront_production_fingerprint: fingerprint,
        })),
      }
      expect(await readPublishedCatalog([snapshot])).toEqual({ status: "unavailable", products: [] })
      expect(console.warn).toHaveBeenCalledExactlyOnceWith("Published product unavailable", {
        reason: "invalid-snapshot",
      })
    }
  )

  it("does not diagnose production mismatches for already sold-out, disabled, or zero-priced variants", async () => {
    const published = fixture()
    published.variants.push({ ...published.variants[1]!, id: 4, price: 0 })
    published.print_areas[0]!.variant_ids.push(4)
    const live = structuredClone(published)
    live.print_areas[0]!.placeholders[0]!.images[0]!.scale = 0.8
    live.variants[1]!.is_enabled = false
    observedProduct.mockResolvedValue(Response.json(live))
    const product = (await readPublishedCatalog([published])).products[0]!
    expect(product.variants.every((variant) => !variant.available)).toBe(true)
    expect(console.warn).not.toHaveBeenCalled()
  })

  it("omits unsafe product identifiers and private values from purchase pause diagnostics", async () => {
    const published = fixture("unsafe\nprivate-token")
    const live = structuredClone(published)
    live.print_areas[0]!.placeholders[0]!.images[0]!.scale = 0.8
    observedProduct.mockResolvedValue(Response.json(live))
    const parsed = parsePrintifyProduct(live, { productId: live.id, shopId: "123" })!
    vi.mocked(readCatalogStock).mockResolvedValue({ [live.id]: parsed.variants })
    await readPublishedCatalog([published])
    expect(console.warn).toHaveBeenCalledExactlyOnceWith("Published product purchase availability paused", {
      code: "PUBLISHED_PRODUCTION_UNAVAILABLE",
      missingProductionVariantCount: 0,
      fingerprintMismatchVariantCount: 1,
    })
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(
      /private-token|private-artwork|Published tee/
    )
  })
})
