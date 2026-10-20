import { revalidateTag, unstable_cache } from "next/cache"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { readCatalogStock } from "@/features/catalog-sync/read-catalog-stock.server"
import { parsePrintifyProduct } from "@/lib/printify/parse-printify-product"

import { readRevealableProduct } from "@/features/publishing/read-revealable-product.server"

import { getSitemapProducts } from "./get-sitemap-products.server"
import { listStorefrontProductIds } from "./list-storefront-product-ids.server"
import { normalizeCatalogProduct } from "./normalize-catalog-product"
import { PublishedSnapshotRejectedError } from "./published-snapshot-rejected-error"
import { readPublishedCatalog } from "./read-published-catalog.server"
import { readStorefrontProduct } from "./read-storefront-product.server"

const { cacheEntries, listRevealableProductIds, testEnv } = vi.hoisted(() => ({
  cacheEntries: new Map<string, { value: unknown; tags: string[] }>(),
  listRevealableProductIds: vi.fn<() => Promise<{ id: string; revealAt: string | null }[]>>(),
  testEnv: {
    DATABASE_URL: "postgresql://store:private-password@localhost/store",
    PRINTIFY_SHOP_ID: "123",
    PRINTIFY_PUBLISHING_ENABLED: true,
  },
}))
vi.mock("@/features/catalog-sync/read-catalog-stock.server", () => ({ readCatalogStock: vi.fn() }))
vi.mock("@/features/garment-catalog/list-garment-display-profiles.server", () => ({
  listGarmentDisplayProfiles: async () => new Map(),
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/env", () => ({ env: testEnv }))
vi.mock("@/features/publishing/read-revealable-product.server", () => ({ readRevealableProduct: vi.fn() }))
vi.mock("@/features/publishing/get-publishing-store.server", () => ({
  getPublishingStore: () => ({ listRevealableProductIds }),
}))
vi.mock("next/cache", () => ({
  unstable_cache: vi.fn(
    (callback: (...args: unknown[]) => Promise<unknown>, keys: string[], options: { tags: string[] }) =>
      async (...args: unknown[]) => {
        const key = JSON.stringify([keys, args])
        const cached = cacheEntries.get(key)
        if (cached) return cached.value
        const value = await callback(...args)
        cacheEntries.set(key, { value, tags: options.tags })
        return value
      }
  ),
  revalidateTag: vi.fn((tag: string) => {
    for (const [key, entry] of cacheEntries) if (entry.tags.includes(tag)) cacheEntries.delete(key)
  }),
}))

function revealable(
  snapshot: Record<string, unknown>,
  revealAt: string | null = null,
  addedToShopAt: string | null = "2026-09-14T12:00:00.000Z"
) {
  return { snapshot, revealAt, addedToShopAt }
}

function fixture() {
  return {
    id: "shirt",
    shop_id: 123,
    title: "Published tee",
    description: "Published description",
    blueprint_id: 1317,
    print_provider_id: 99,
    print_areas: [
      {
        variant_ids: [1, 2, 3],
        placeholders: [
          { position: "front", images: [{ id: "private-artwork-source", x: 0.5, y: 0.5, scale: 1, angle: 0 }] },
        ],
      },
    ],
    variants: [
      { id: 1, price: 2500, is_enabled: true, is_available: true, options: [10] },
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
      { src: "https://images.printify.com/disabled.jpg", variant_ids: [3], is_default: false },
    ],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  cacheEntries.clear()
  vi.mocked(readRevealableProduct).mockReset()
  listRevealableProductIds.mockReset()
  testEnv.DATABASE_URL = "postgresql://store:private-password@localhost/store"
  testEnv.PRINTIFY_SHOP_ID = "123"
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
  vi.spyOn(console, "error").mockImplementation(() => undefined)
})
afterEach(() => vi.restoreAllMocks())

describe("storefront publication cache", () => {
  it("caches a validated display projection and excludes private and disabled product data", async () => {
    vi.mocked(readRevealableProduct).mockResolvedValue(revealable(fixture()))
    const snapshot = await readStorefrontProduct("shirt")
    expect(snapshot).not.toHaveProperty("print_areas")
    expect(snapshot?.blueprint_id).toBe(1317)
    expect(snapshot?.variants).toHaveLength(2)
    expect(snapshot?.variants).toEqual([
      expect.objectContaining({ id: 1, storefront_production_fingerprint: expect.stringMatching(/^v2:[a-f0-9]{64}$/) }),
      expect.objectContaining({ id: 2, storefront_production_fingerprint: expect.stringMatching(/^v2:[a-f0-9]{64}$/) }),
    ])
    expect(JSON.stringify(snapshot)).not.toContain("private-artwork-source")
    expect(JSON.stringify(normalizeCatalogProduct(snapshot))).not.toContain("fingerprint")
    expect(snapshot?.images).toHaveLength(2)
    expect(snapshot?.storefront_added_to_shop_at).toBe("2026-09-14T12:00:00.000Z")
    expect(normalizeCatalogProduct(snapshot)).toMatchObject({
      defaultColor: "Green",
      image: { src: "https://images.printify.com/green.jpg" },
      addedToShopAt: "2026-09-14T12:00:00.000Z",
    })
    await readStorefrontProduct("shirt")
    expect(readRevealableProduct).toHaveBeenCalledExactlyOnceWith("shirt")
    expect(vi.mocked(unstable_cache).mock.calls[0]?.[1]).toEqual([
      "published-catalog-product-v2",
      "v2",
      "123",
      expect.stringMatching(/^[a-f0-9]{64}$/),
    ])
    expect(vi.mocked(unstable_cache).mock.calls[0]?.[2]).toEqual({
      revalidate: 300,
      tags: ["printify-published-catalog"],
    })
    expect(JSON.stringify(vi.mocked(unstable_cache).mock.calls.map((call) => call.slice(1)))).not.toContain(
      "private-password"
    )
  })

  it("keeps long-titled provider products available through the cached projection and catalog reparse", async () => {
    const raw = fixture()
    raw.title = "A long product title ".repeat(30).trim()
    const snapshot = {
      ...raw,
      images: raw.images.map((image) => ({ ...image, alt: null, origin: "unexpected-provider-field" })),
    }
    vi.mocked(readRevealableProduct).mockResolvedValue(revealable(snapshot))
    vi.mocked(readCatalogStock).mockResolvedValue({
      shirt: parsePrintifyProduct(raw, { productId: "shirt", shopId: "123" })!.variants,
    })
    const projected = await readStorefrontProduct("shirt")
    expect(projected?.images).toEqual([expect.not.objectContaining({ origin: expect.anything() }), expect.anything()])
    expect(normalizeCatalogProduct(projected).images[0]?.alt).toHaveLength(300)
    const result = await readPublishedCatalog([projected!])
    expect(result.status).toBe("ready")
    expect(result.products[0]?.title).toBe(raw.title)
    expect(result.products[0]?.variants.some((variant) => variant.available)).toBe(true)
  })

  it("caches approved photo alt text and store origin for the storefront to render", async () => {
    const raw = fixture()
    const photo = `https://catalog.public.blob.vercel-storage.com/published-product-photos/v1/${"c".repeat(64)}.jpg`
    raw.images[1] = { src: photo, variant_ids: [2], is_default: true }
    vi.mocked(readRevealableProduct).mockResolvedValue(
      revealable({
        ...raw,
        images: raw.images.map((image) =>
          image.src === photo ? { ...image, alt: "  Sample tee folded on a table  ", origin: "store" } : image
        ),
      })
    )
    const projected = await readStorefrontProduct("shirt")
    expect(projected?.images).toEqual([
      { src: photo, alt: "Sample tee folded on a table", origin: "store", variant_ids: [2], is_default: true },
      { src: raw.images[0]!.src, alt: "Published tee", variant_ids: [1], is_default: false },
    ])
    expect(normalizeCatalogProduct(projected)).toMatchObject({
      image: { src: photo, alt: "Sample tee folded on a table", origin: "store" },
      images: [{ origin: "store" }, expect.not.objectContaining({ origin: expect.anything() })],
    })
  })

  it("caches camera identities from hosted mockups while keeping recovery URLs private", async () => {
    const raw = fixture()
    const images = raw.images.map((image, index) => ({
      ...image,
      src: `https://catalog.public.blob.vercel-storage.com/published-mockups/v1/${String(index).repeat(64)}.jpg`,
      source_src: `https://images-api.printify.com/mockup/shirt/${index}/camera/tee.jpg?camera_label=${index === 1 ? "person-1-front" : "front"}&internal=private-recovery`,
    }))
    vi.mocked(readRevealableProduct).mockResolvedValue(revealable({ ...raw, images }))
    const snapshot = await readStorefrontProduct("shirt")
    expect(snapshot?.images).toEqual([
      { src: images[1]!.src, alt: "Published tee", variant_ids: [2], is_default: true, view_key: "person-1-front" },
      { src: images[0]!.src, alt: "Published tee", variant_ids: [1], is_default: false, view_key: "front" },
    ])
    expect(JSON.stringify(snapshot)).not.toMatch(/source_src|images-api\.printify\.com|private-recovery/)
    expect(normalizeCatalogProduct(snapshot).images.map((image) => image.viewKey)).toEqual(["person-1-front", "front"])
    expect(await readStorefrontProduct("shirt")).toEqual(snapshot)
    expect(readRevealableProduct).toHaveBeenCalledExactlyOnceWith("shirt")
  })

  it("compares live production against the same published revision used for display without exposing hashes", async () => {
    const published = fixture()
    vi.mocked(readRevealableProduct).mockResolvedValue(revealable(published))
    const snapshot = await readStorefrontProduct("shirt")
    const live = structuredClone(published)
    Object.assign(live.variants[0]!, { sku: "unpublished-sku-change" })
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(live))
    vi.mocked(readCatalogStock).mockResolvedValue({
      shirt: parsePrintifyProduct(live, { productId: "shirt", shopId: "123" })!.variants,
    })
    const result = await readPublishedCatalog([snapshot!])
    expect(result.products[0]?.variants.map((variant) => ({ id: variant.id, available: variant.available }))).toEqual([
      { id: 1, available: false },
      { id: 2, available: true },
    ])
    expect(result.products[0]?.title).toBe("Published tee")
    expect(JSON.stringify(result)).not.toMatch(/fingerprint|private-artwork-source|unpublished-sku-change/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([{ print_areas: [] }, { print_details: { print_on_side: "private invalid value", separator_type: false } }])(
    "rejects a publication whose production data does not match the current schema: %j",
    async (productionChanges) => {
      const raw = { ...fixture(), ...productionChanges }
      vi.mocked(readRevealableProduct).mockResolvedValue(revealable(raw))
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(fixture()))
      await expect(readStorefrontProduct("shirt")).rejects.toBeInstanceOf(PublishedSnapshotRejectedError)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(cacheEntries.size).toBe(0)
      expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private invalid value")
    }
  )

  it.each([{ print_areas: [] }, { print_details: { print_on_side: "private invalid value", separator_type: false } }])(
    "withholds only the snapshot rejected by the production parser from sitemap membership: %j",
    async (productionChanges) => {
      listRevealableProductIds.mockResolvedValue([
        { id: "valid", revealAt: null },
        { id: "rejected", revealAt: null },
      ])
      vi.mocked(readRevealableProduct).mockImplementation(async (id) =>
        revealable({ ...fixture(), id, ...(id === "rejected" ? productionChanges : {}) })
      )
      const fetchMock = vi.spyOn(globalThis, "fetch")

      await expect(getSitemapProducts()).resolves.toEqual([
        {
          id: "valid",
          title: fixture().title,
          lastModified: "2026-09-14T12:00:00.000Z",
          image: fixture().images.find((image) => image.is_default)!.src,
        },
      ])
      expect(fetchMock).not.toHaveBeenCalled()

      // A rejected cache fill must not keep a repaired publication out of the sitemap.
      vi.mocked(readRevealableProduct).mockImplementation(async (id) => revealable({ ...fixture(), id }))
      await expect(getSitemapProducts().then((products) => products.map((product) => product.id))).resolves.toEqual([
        "valid",
        "rejected",
      ])
    }
  )

  it.each([new Error("private-password"), new PublishedSnapshotRejectedError()])(
    "still rejects the sitemap when one product storage read fails: %s",
    async (storageFailure) => {
      listRevealableProductIds.mockResolvedValue([
        { id: "valid", revealAt: null },
        { id: "offline", revealAt: null },
      ])
      vi.mocked(readRevealableProduct).mockImplementation(async (id) => {
        if (id === "offline") throw storageFailure
        return revealable({ ...fixture(), id })
      })

      await expect(getSitemapProducts()).rejects.toThrow("Published product unavailable")
    }
  )

  it("invalidates empty membership, missing products, published images, and deleted membership with the publication tag", async () => {
    listRevealableProductIds.mockResolvedValue([])
    vi.mocked(readRevealableProduct).mockResolvedValue(null)
    expect(await listStorefrontProductIds()).toEqual([])
    expect(await readStorefrontProduct("shirt")).toBeNull()

    listRevealableProductIds.mockResolvedValue([{ id: "shirt", revealAt: null }])
    vi.mocked(readRevealableProduct).mockResolvedValue(revealable(fixture()))
    expect(await listStorefrontProductIds()).toEqual([])
    expect(await readStorefrontProduct("shirt")).toBeNull()
    revalidateTag("printify-published-catalog", { expire: 0 })
    expect(await listStorefrontProductIds()).toEqual(["shirt"])
    expect(normalizeCatalogProduct(await readStorefrontProduct("shirt")).defaultColor).toBe("Green")

    const updated = fixture()
    updated.title = "New published title"
    updated.images.forEach((image) => {
      image.is_default = image.src.includes("grey")
    })
    vi.mocked(readRevealableProduct).mockResolvedValue(revealable(updated))
    expect(normalizeCatalogProduct(await readStorefrontProduct("shirt")).defaultColor).toBe("Green")
    // The original storage read remains fresh for checkout, independent of the storefront cache.
    expect((await readRevealableProduct("shirt"))?.snapshot).toMatchObject({ title: "New published title" })
    revalidateTag("printify-published-catalog", { expire: 0 })
    expect(normalizeCatalogProduct(await readStorefrontProduct("shirt"))).toMatchObject({
      title: "New published title",
      defaultColor: "Grey",
    })

    listRevealableProductIds.mockResolvedValue([])
    vi.mocked(readRevealableProduct).mockResolvedValue(null)
    revalidateTag("printify-published-catalog", { expire: 0 })
    expect(await listStorefrontProductIds()).toEqual([])
    expect(await readStorefrontProduct("shirt")).toBeNull()
  })

  // A scheduled reveal writes nothing, so no tag revalidation ever fires for it. The comparison has
  // to happen outside the cache, or a product would stay dark for the rest of the 300s window.
  it("withholds a product until its moment arrives without re-reading storage", async () => {
    const later = new Date(Date.now() + 60_000).toISOString()
    vi.mocked(readRevealableProduct).mockResolvedValue(revealable(fixture(), later))
    expect(await readStorefrontProduct("shirt")).toBeNull()
    expect(await readStorefrontProduct("shirt")).toBeNull()
    expect(readRevealableProduct).toHaveBeenCalledExactlyOnceWith("shirt")

    // Same cached entry, later clock, no revalidation: this is the only shape that tells a
    // comparison outside the cache from one inside it, where the null would sit out the window.
    vi.setSystemTime(new Date(Date.parse(later) + 1000))
    try {
      const revealed = await readStorefrontProduct("shirt")
      expect(revealed).not.toBeNull()
      // Settled inside the cache before the moment, and right once it is let out: the reveal is the arrival.
      expect(revealed?.storefront_added_to_shop_at).toBe(later)
      expect(readRevealableProduct).toHaveBeenCalledExactlyOnceWith("shirt")
    } finally {
      vi.useRealTimers()
    }
  })

  // A timed reveal writes nothing, so a product the clock brought back still carries the stamp from
  // its previous visit. Newest and the New badge have to see the return, not that old stamp.
  it("carries an arrived reveal as the arrival when it is later than the stored stamp", async () => {
    const stamp = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString()
    const reveal = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
    vi.mocked(readRevealableProduct).mockResolvedValue(revealable(fixture(), reveal, stamp))
    const projection = await readStorefrontProduct("shirt")
    expect(projection).toMatchObject({ storefront_reveal_at: reveal, storefront_added_to_shop_at: reveal })
    expect(normalizeCatalogProduct(projection).addedToShopAt).toBe(reveal)
  })

  it("keeps a stamp later than the reveal, and carries no arrival when the row has none", async () => {
    const reveal = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
    const stamp = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    vi.mocked(readRevealableProduct).mockResolvedValue(revealable(fixture(), reveal, stamp))
    expect((await readStorefrontProduct("shirt"))?.storefront_added_to_shop_at).toBe(stamp)

    cacheEntries.clear()
    vi.mocked(readRevealableProduct).mockResolvedValue(revealable(fixture(), null, null))
    const undated = await readStorefrontProduct("shirt")
    expect(undated).not.toBeNull()
    expect(undated?.storefront_added_to_shop_at).toBeNull()
    expect(normalizeCatalogProduct(undated).addedToShopAt).toBeNull()
  })

  it("drops a product whose moment has not arrived from shop membership", async () => {
    listRevealableProductIds.mockResolvedValue([
      { id: "shirt", revealAt: null },
      { id: "reveals-later", revealAt: new Date(Date.now() + 60_000).toISOString() },
      { id: "reveal-passed", revealAt: new Date(Date.now() - 60_000).toISOString() },
    ])
    expect(await listStorefrontProductIds()).toEqual(["shirt", "reveal-passed"])
    expect(vi.mocked(unstable_cache).mock.calls[0]?.[1]?.[0]).toBe("published-catalog-membership-v1")

    // The moment passes with no write and no re-read, and the product joins the shop anyway.
    vi.setSystemTime(new Date(Date.now() + 120_000))
    try {
      expect(await listStorefrontProductIds()).toEqual(["shirt", "reveals-later", "reveal-passed"])
      expect(listRevealableProductIds).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("does not cache database failures as missing products or empty membership", async () => {
    vi.mocked(readRevealableProduct).mockRejectedValueOnce(new Error("private-password"))
    listRevealableProductIds.mockRejectedValueOnce(new Error("private-password"))
    await expect(readStorefrontProduct("shirt")).rejects.toThrow("Published product unavailable")
    await expect(listStorefrontProductIds()).rejects.toThrow("Published catalog membership unavailable")
    vi.mocked(readRevealableProduct).mockResolvedValue(revealable(fixture()))
    listRevealableProductIds.mockResolvedValue([{ id: "shirt", revealAt: null }])
    expect(await readStorefrontProduct("shirt")).not.toBeNull()
    expect(await listStorefrontProductIds()).toEqual(["shirt"])
    expect(readRevealableProduct).toHaveBeenCalledTimes(2)
    expect(listRevealableProductIds).toHaveBeenCalledTimes(2)
  })

  it("omits unsafe identifiers from missing production diagnostics", async () => {
    const id = "unsafe\nprivate-product"
    vi.mocked(readRevealableProduct).mockResolvedValue(revealable({ ...fixture(), id, print_areas: [] }))
    await expect(readStorefrontProduct(id)).rejects.toThrow("Published product unavailable")
    expect(cacheEntries.size).toBe(0)
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(id)
  })

  it.each([{ id: "wrong-product" }, { shop_id: 456 }, { variants: "invalid" }])(
    "rejects invalid or mismatched cached snapshots: %j",
    async (changes) => {
      vi.mocked(readRevealableProduct).mockResolvedValue(revealable({ ...fixture(), ...changes }))
      await expect(readStorefrontProduct("shirt")).rejects.toBeInstanceOf(PublishedSnapshotRejectedError)
      expect(cacheEntries.size).toBe(0)
    }
  )

  it("isolates cache entries across database environments and shops", async () => {
    listRevealableProductIds.mockResolvedValue([{ id: "shirt", revealAt: null }])
    await listStorefrontProductIds()
    testEnv.DATABASE_URL = "postgresql://store:other-private-password@localhost/other-store"
    await listStorefrontProductIds()
    testEnv.PRINTIFY_SHOP_ID = "456"
    await listStorefrontProductIds()
    expect(listRevealableProductIds).toHaveBeenCalledTimes(3)
    expect(new Set(vi.mocked(unstable_cache).mock.calls.map((call) => JSON.stringify(call[1]))).size).toBe(3)
  })
})
