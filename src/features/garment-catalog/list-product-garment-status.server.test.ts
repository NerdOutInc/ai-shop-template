// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ProductGarmentStatus } from "./garment-catalog"

import { listProductGarmentStatus } from "./list-product-garment-status.server"

const { getPublishingStore, listStatus } = vi.hoisted(() => ({ getPublishingStore: vi.fn(), listStatus: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("@/features/publishing/get-publishing-store.server", () => ({ getPublishingStore }))

const statuses: ProductGarmentStatus[] = [
  { productId: "ready-tee", blueprintId: 1317, complete: true, label: "Next Level 6210" },
  { productId: "new-hoodie", blueprintId: 9999, complete: false, label: null },
  { productId: "broken-snapshot", blueprintId: null, complete: false, label: null },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "warn").mockImplementation(() => {})
  getPublishingStore.mockReturnValue({ garments: { listProductGarmentStatus: listStatus } })
  listStatus.mockResolvedValue(statuses)
})

describe("listProductGarmentStatus", () => {
  // `complete` is the database's generated column. Recomputing it here from the other fields would
  // be a second definition of complete, and the two would eventually disagree.
  it("hands the store's answer over untouched, complete flags included", async () => {
    expect(await listProductGarmentStatus()).toEqual(statuses)
    expect(console.warn).not.toHaveBeenCalled()
  })

  // An empty list is an answer ("no active products"); null is the absence of one. The Products
  // page must be able to tell them apart, or an outage would read as "every garment is fine".
  it("returns an empty list, not null, when the shop has no active products", async () => {
    listStatus.mockResolvedValue([])
    expect(await listProductGarmentStatus()).toEqual([])
  })

  it("returns null without the details when the garment tables cannot be read", async () => {
    listStatus.mockRejectedValue(new Error('relation "commerce.garment_models" on private database host'))
    expect(await listProductGarmentStatus()).toBeNull()
    expect(console.warn).toHaveBeenCalledWith("Product garment status unavailable", { reason: "storage" })
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("private database host")
  })

  it("returns null when publishing storage is not configured at all", async () => {
    getPublishingStore.mockImplementation(() => {
      throw new Error("Publishing storage is not configured")
    })
    expect(await listProductGarmentStatus()).toBeNull()
    expect(console.warn).toHaveBeenCalledWith("Product garment status unavailable", { reason: "storage" })
  })
})
