import { beforeEach, describe, expect, it, vi } from "vitest"

import { getSitemapProductIds } from "./get-sitemap-product-ids.server"
import { listStorefrontProductIds } from "./list-storefront-product-ids.server"
import { PublishedSnapshotRejectedError } from "./published-snapshot-rejected-error"
import { readStorefrontProduct } from "./read-storefront-product.server"

vi.mock("server-only", () => ({}))
const config = vi.hoisted(() => ({
  PRINTIFY_PUBLISHING_ENABLED: true,
  PRINTIFY_API_TOKEN: "test",
  PRINTIFY_SHOP_ID: "123",
}))
vi.mock("@/lib/env", () => ({ env: config }))
vi.mock("./list-storefront-product-ids.server", () => ({ listStorefrontProductIds: vi.fn() }))
vi.mock("./read-storefront-product.server", () => ({ readStorefrontProduct: vi.fn() }))

beforeEach(() => {
  vi.resetAllMocks()
  config.PRINTIFY_PUBLISHING_ENABLED = true
})

describe("sitemap publication membership", () => {
  it("includes published sold-out listings and skips newly hidden listings without stock or order calls", async () => {
    vi.mocked(listStorefrontProductIds).mockResolvedValue(["sold-out", "hidden"])
    vi.mocked(readStorefrontProduct).mockImplementation(async (id) => (id === "hidden" ? null : { id, variants: [] }))
    expect(await getSitemapProductIds()).toEqual(["sold-out"])
  })
  it("rejects failed storage reads instead of returning an incomplete sitemap", async () => {
    vi.mocked(listStorefrontProductIds).mockResolvedValue(["a", "b"])
    vi.mocked(readStorefrontProduct).mockResolvedValueOnce({ id: "a" }).mockRejectedValueOnce(new Error("offline"))
    await expect(getSitemapProductIds()).rejects.toThrow()
  })
  it("omits rejected snapshots without swallowing errors with the same public message", async () => {
    vi.mocked(listStorefrontProductIds).mockResolvedValue(["valid", "rejected"])
    vi.mocked(readStorefrontProduct)
      .mockResolvedValueOnce({ id: "valid" })
      .mockRejectedValueOnce(new PublishedSnapshotRejectedError())
    await expect(getSitemapProductIds()).resolves.toEqual(["valid"])

    vi.mocked(readStorefrontProduct)
      .mockResolvedValueOnce({ id: "valid" })
      .mockRejectedValueOnce(new Error("Published product unavailable"))
    await expect(getSitemapProductIds()).rejects.toThrow("Published product unavailable")
  })
  it("rejects a disabled store without reading any data", async () => {
    config.PRINTIFY_PUBLISHING_ENABLED = false
    await expect(getSitemapProductIds()).rejects.toThrow("Published catalog is not enabled")
    expect(listStorefrontProductIds).not.toHaveBeenCalled()
  })
})
