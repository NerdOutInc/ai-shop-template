import { beforeEach, describe, expect, it, vi } from "vitest"

import { normalizeCatalogProduct } from "@/features/catalog/normalize-catalog-product"
import { listGarmentDisplayProfiles } from "@/features/garment-catalog/list-garment-display-profiles.server"
import { getMerchantProducts } from "@/features/merchant-feed/get-merchant-products.server"
import { MerchantFeedError } from "@/features/merchant-feed/merchant-feed-error"
import { galleryProductFixture } from "../../../test/gallery-product-fixture"

import type { AgentCatalog, AgentCatalogProduct } from "./agent-catalog"
import { createAgentCatalogResponse } from "./create-agent-catalog-response.server"

vi.mock("server-only", () => ({}))
vi.mock("@/features/merchant-feed/get-merchant-products.server", () => ({ getMerchantProducts: vi.fn() }))
vi.mock("@/features/garment-catalog/list-garment-display-profiles.server", () => ({
  listGarmentDisplayProfiles: vi.fn(),
}))
vi.mock("@/lib/get-site-url", () => ({ getSiteUrl: () => new URL("https://store.example") }))
const config = vi.hoisted(() => ({ indexable: true }))
vi.mock("@/lib/is-indexable-site", () => ({ isIndexableSite: () => config.indexable }))

const apparel = { googleProductCategory: 212, ageGroup: "adult", gender: "unisex", sizeSystem: "US" } as const
const garment = {
  manufacturer: "Bella+Canvas",
  model: "3001",
  categoryName: "T-shirts",
  categorySlug: "t-shirts",
  categorySortPosition: 1,
  gender: "unisex",
} as const

beforeEach(() => {
  config.indexable = true
  vi.mocked(getMerchantProducts).mockResolvedValue([
    { product: normalizeCatalogProduct(galleryProductFixture()), apparel, blueprintId: 12 },
    { product: normalizeCatalogProduct({ ...galleryProductFixture(), id: "unlabeled" }), apparel, blueprintId: 99 },
  ])
  vi.mocked(listGarmentDisplayProfiles).mockResolvedValue(new Map([[12, garment]]))
  vi.spyOn(console, "error").mockImplementation(() => undefined)
})

describe("the public JSON catalog", () => {
  it("serves every merchant-feed product with its shop category and shared caching", async () => {
    const response = await createAgentCatalogResponse()
    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toContain("application/json")
    expect(response.headers.get("Cache-Control")).toBe("public, s-maxage=300, stale-while-revalidate=600")
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex")
    const catalog = (await response.json()) as AgentCatalog
    expect(catalog.store).toMatchObject({ name: "Fixture Store", url: "https://store.example/", currency: "USD" })
    expect(catalog.products.map((product) => [product.id, product.category])).toEqual([
      ["shirt", "T-shirts"],
      ["unlabeled", null],
    ])
    expect(catalog.products[0]?.variants).toHaveLength(2)
  })
  it("serves one product by id and a 404 for an unknown or withheld id", async () => {
    const response = await createAgentCatalogResponse("unlabeled")
    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("public, s-maxage=300, stale-while-revalidate=600")
    const body = (await response.json()) as { store: AgentCatalog["store"]; product: AgentCatalogProduct }
    expect(Object.keys(body)).toEqual(["store", "product"])
    expect(body.product).toMatchObject({ id: "unlabeled", url: "https://store.example/shop/unlabeled" })
    const missing = await createAgentCatalogResponse("hidden")
    expect(missing.status).toBe(404)
    expect(missing.headers.get("Cache-Control")).toBe("no-store")
    expect(await missing.json()).toEqual({ error: "Product not found" })
  })
  it("still lists products when garment labels cannot be read", async () => {
    vi.mocked(listGarmentDisplayProfiles).mockResolvedValue(null)
    const catalog = (await (await createAgentCatalogResponse()).json()) as AgentCatalog
    expect(catalog.products.map((product) => product.category)).toEqual([null, null])
  })
  it("returns an uncached retryable 503 on a feed failure, logging only the failure code", async () => {
    vi.mocked(getMerchantProducts).mockRejectedValue(new MerchantFeedError("STOCK_UNAVAILABLE", "shirt"))
    const response = await createAgentCatalogResponse()
    expect(response.status).toBe(503)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(response.headers.get("Retry-After")).toBe("300")
    expect(await response.json()).toEqual({ error: "Catalog temporarily unavailable" })
    expect(console.error).toHaveBeenCalledWith("Agent catalog unavailable", {
      code: "STOCK_UNAVAILABLE",
      productId: "shirt",
    })
    vi.mocked(getMerchantProducts).mockRejectedValue(new Error("postgresql://user:private-password@db/store"))
    expect((await createAgentCatalogResponse()).status).toBe(503)
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private-password")
  })
  it("is absent on previews and unconfigured stores without reading the catalog", async () => {
    config.indexable = false
    for (const response of [await createAgentCatalogResponse(), await createAgentCatalogResponse("shirt")]) {
      expect(response.status).toBe(404)
      expect(response.headers.get("X-Robots-Tag")).toBe("noindex")
    }
    expect(getMerchantProducts).not.toHaveBeenCalled()
  })
})
