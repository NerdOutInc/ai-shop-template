import { beforeEach, describe, expect, it, vi } from "vitest"

import { createCatalogFixture } from "../../../test/create-catalog-fixture"

import { getSitemapProducts } from "./get-sitemap-products.server"
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

function snapshot(id: string, changes: Record<string, unknown> = {}) {
  return { ...createCatalogFixture(id), ...changes }
}
const ids = (products: Promise<{ id: string }[]>) => products.then((list) => list.map((product) => product.id))

beforeEach(() => {
  vi.resetAllMocks()
  config.PRINTIFY_PUBLISHING_ENABLED = true
})

describe("sitemap publication membership", () => {
  it("includes published sold-out listings and skips newly hidden listings without stock or order calls", async () => {
    vi.mocked(listStorefrontProductIds).mockResolvedValue(["sold-out", "hidden"])
    vi.mocked(readStorefrontProduct).mockImplementation(async (id) =>
      id === "hidden" ? null : snapshot(id, { storefront_added_to_shop_at: "2026-09-14T12:00:00.000Z" })
    )
    expect(await getSitemapProducts()).toEqual([
      {
        id: "sold-out",
        title: "Published tee",
        lastModified: "2026-09-14T12:00:00.000Z",
        image: "https://images.printify.com/green.jpg",
      },
    ])
  })
  it("dates a republished product by its content write and a revealed one by its arrival", async () => {
    vi.mocked(listStorefrontProductIds).mockResolvedValue(["republished", "revealed", "unstamped"])
    vi.mocked(readStorefrontProduct).mockImplementation(async (id) =>
      snapshot(
        id,
        id === "republished"
          ? { storefront_added_to_shop_at: "2026-09-01T12:00:00.000Z", storefront_updated_at: "2026-09-20T08:00:00Z" }
          : id === "revealed"
            ? { storefront_added_to_shop_at: "2026-09-25T17:30:00.000Z", storefront_updated_at: "2026-09-20T08:00:00Z" }
            : { storefront_updated_at: "not a date" }
      )
    )
    expect((await getSitemapProducts()).map((product) => [product.id, product.lastModified])).toEqual([
      ["republished", "2026-09-20T08:00:00.000Z"],
      ["revealed", "2026-09-25T17:30:00.000Z"],
      ["unstamped", null],
    ])
  })
  it("strips the store suffix from titles and tolerates a missing stamp or photo", async () => {
    vi.mocked(listStorefrontProductIds).mockResolvedValue(["bare"])
    vi.mocked(readStorefrontProduct).mockResolvedValue(
      snapshot("bare", { title: "Morning Scene — Fixture Store | Next Level 6210", images: [] })
    )
    expect(await getSitemapProducts()).toEqual([
      { id: "bare", title: "Morning Scene", lastModified: null, image: null },
    ])
  })
  it("rejects failed storage reads instead of returning an incomplete sitemap", async () => {
    vi.mocked(listStorefrontProductIds).mockResolvedValue(["a", "b"])
    vi.mocked(readStorefrontProduct).mockResolvedValueOnce(snapshot("a")).mockRejectedValueOnce(new Error("offline"))
    await expect(getSitemapProducts()).rejects.toThrow()
  })
  it("omits rejected snapshots without swallowing errors with the same public message", async () => {
    vi.mocked(listStorefrontProductIds).mockResolvedValue(["valid", "rejected"])
    vi.mocked(readStorefrontProduct)
      .mockResolvedValueOnce(snapshot("valid"))
      .mockRejectedValueOnce(new PublishedSnapshotRejectedError())
    await expect(ids(getSitemapProducts())).resolves.toEqual(["valid"])

    vi.mocked(readStorefrontProduct)
      .mockResolvedValueOnce(snapshot("valid"))
      .mockRejectedValueOnce(new Error("Published product unavailable"))
    await expect(getSitemapProducts()).rejects.toThrow("Published product unavailable")
  })
  it("rejects a disabled store without reading any data", async () => {
    config.PRINTIFY_PUBLISHING_ENABLED = false
    await expect(getSitemapProducts()).rejects.toThrow("Published catalog is not enabled")
    expect(listStorefrontProductIds).not.toHaveBeenCalled()
  })
})
