import { beforeEach, describe, expect, it, vi } from "vitest"

import { readStorefrontProduct } from "./read-storefront-product.server"
import { normalizeCatalogProduct } from "./normalize-catalog-product"

import { readPublishedCatalog } from "./read-published-catalog.server"
import { getCatalogProduct } from "./get-catalog-product.server"
const selectedProductIds = ["fixture-product"] as const

vi.mock("server-only", () => ({}))
const { testEnv } = vi.hoisted(() => ({
  testEnv: { PRINTIFY_API_TOKEN: "private-token", PRINTIFY_SHOP_ID: "1234", PRINTIFY_PUBLISHING_ENABLED: false },
}))
vi.mock("@/lib/env", () => ({ env: testEnv }))
vi.mock("./read-storefront-product.server", () => ({ readStorefrontProduct: vi.fn() }))
vi.mock("./read-published-catalog.server", () => ({ readPublishedCatalog: vi.fn() }))
beforeEach(() => {
  vi.mocked(readStorefrontProduct).mockReset()
  vi.mocked(readPublishedCatalog).mockReset()
  testEnv.PRINTIFY_PUBLISHING_ENABLED = false
})

describe("getCatalogProduct", () => {
  it("uses database membership for a published product outside the sample selection", async () => {
    testEnv.PRINTIFY_PUBLISHING_ENABLED = true
    const snapshot = { id: "new-published-product" }
    vi.mocked(readStorefrontProduct).mockResolvedValue(snapshot)
    vi.mocked(readPublishedCatalog).mockResolvedValue({ status: "ready", products: [] })
    await getCatalogProduct("new-published-product")
    expect(readStorefrontProduct).toHaveBeenCalledExactlyOnceWith("new-published-product")
    expect(readPublishedCatalog).toHaveBeenCalledExactlyOnceWith([snapshot])
  })

  it("returns unavailable rather than missing when publication storage fails", async () => {
    testEnv.PRINTIFY_PUBLISHING_ENABLED = true
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    vi.mocked(readStorefrontProduct).mockRejectedValue(new Error("private database credential"))
    expect(await getCatalogProduct("published-product")).toEqual({ status: "unavailable" })
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private database credential")
    warn.mockRestore()
  })

  it("returns unavailable when an existing published snapshot cannot be normalized", async () => {
    testEnv.PRINTIFY_PUBLISHING_ENABLED = true
    vi.mocked(readStorefrontProduct).mockResolvedValue({ id: "published-product" })
    vi.mocked(readPublishedCatalog).mockResolvedValue({ status: "unavailable", products: [] })
    expect(await getCatalogProduct("published-product")).toEqual({ status: "unavailable" })
  })

  it("returns the ready product when its published snapshot and display stock load", async () => {
    testEnv.PRINTIFY_PUBLISHING_ENABLED = true
    const product = normalizeCatalogProduct({
      id: "published-product",
      shop_id: 1234,
      title: "Published tee",
      variants: [],
      options: [],
      images: [],
    })
    vi.mocked(readStorefrontProduct).mockResolvedValue({ id: product.id })
    vi.mocked(readPublishedCatalog).mockResolvedValue({ status: "ready", products: [product] })
    expect(await getCatalogProduct(product.id)).toEqual({ status: "ready", product, isNew: false })
  })

  // Decided beside the product, so the page never reads a clock while it renders.
  it.each([
    { age: "three days", arrived: "2026-09-17T12:00:00.000Z", isNew: true },
    { age: "two weeks less a millisecond", arrived: "2026-09-06T12:00:00.001Z", isNew: true },
    { age: "exactly two weeks", arrived: "2026-09-06T12:00:00.000Z", isNew: false },
    { age: "forty days", arrived: "2026-08-11T12:00:00.000Z", isNew: false },
  ])("marks a product that arrived $age ago as new: $isNew", async ({ arrived, isNew }) => {
    testEnv.PRINTIFY_PUBLISHING_ENABLED = true
    const product = normalizeCatalogProduct({
      id: "published-product",
      shop_id: 1234,
      title: "Published tee",
      variants: [],
      options: [],
      images: [],
      storefront_added_to_shop_at: arrived,
    })
    vi.mocked(readStorefrontProduct).mockResolvedValue({ id: product.id })
    vi.mocked(readPublishedCatalog).mockResolvedValue({ status: "ready", products: [product] })
    vi.setSystemTime(new Date("2026-09-20T12:00:00.000Z"))
    try {
      expect(await getCatalogProduct(product.id)).toEqual({ status: "ready", product, isNew })
    } finally {
      vi.useRealTimers()
    }
  })

  it("does not expose an unpublished product or fetch its live draft", async () => {
    testEnv.PRINTIFY_PUBLISHING_ENABLED = true
    vi.mocked(readStorefrontProduct).mockResolvedValue(null)
    expect(await getCatalogProduct(selectedProductIds[0])).toEqual({ status: "missing" })
    expect(readPublishedCatalog).not.toHaveBeenCalled()
  })

  it("requires publishing even for an old curated product", async () => {
    expect(await getCatalogProduct(selectedProductIds[0])).toEqual({ status: "unavailable" })
    expect(readStorefrontProduct).not.toHaveBeenCalled()
    expect(readPublishedCatalog).not.toHaveBeenCalled()
  })
})
