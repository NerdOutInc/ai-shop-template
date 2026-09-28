// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { AdminGarment, ShopCategory } from "./garment-catalog"

import { listAdminGarmentSetup } from "./list-admin-garment-setup.server"

const { getPublishingStore, listCategories, listGarments } = vi.hoisted(() => ({
  getPublishingStore: vi.fn(),
  listCategories: vi.fn(),
  listGarments: vi.fn(),
}))
vi.mock("server-only", () => ({}))
vi.mock("@/features/publishing/get-publishing-store.server", () => ({ getPublishingStore }))

const categories: ShopCategory[] = [
  { slug: "t-shirts", name: "T-shirts", garmentCount: 1 },
  { slug: "crop-tops", name: "Crop tops", garmentCount: 0 },
]
const garments: AdminGarment[] = [
  {
    blueprintId: 9999,
    known: false,
    complete: false,
    manufacturer: null,
    model: null,
    categorySlug: null,
    googleProductCategory: null,
    gender: null,
    ageGroup: null,
    sizeSystem: null,
    productCount: 2,
    shownCount: 1,
    scheduledCount: 0,
  },
  {
    blueprintId: 1317,
    known: true,
    complete: true,
    manufacturer: "Next Level",
    model: "6210",
    categorySlug: "t-shirts",
    googleProductCategory: 212,
    gender: "unisex",
    ageGroup: "adult",
    sizeSystem: "US",
    productCount: 12,
    shownCount: 10,
    scheduledCount: 1,
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "warn").mockImplementation(() => {})
  getPublishingStore.mockReturnValue({ garments: { listCategories, listGarments } })
  listCategories.mockResolvedValue(categories)
  listGarments.mockResolvedValue({ garments, productsWithoutBlueprint: 3 })
})

describe("listAdminGarmentSetup", () => {
  // The store already sorts both lists (categories by position, garments needing setup first), so
  // the order it hands over is the order the pages draw.
  it("hands the pages the store's categories, garments and unreadable-product count as they came", async () => {
    expect(await listAdminGarmentSetup()).toEqual({
      status: "ready",
      categories,
      garments,
      productsWithoutBlueprint: 3,
    })
    expect(console.warn).not.toHaveBeenCalled()
  })

  it("is ready with empty lists for a shop that has set nothing up", async () => {
    listCategories.mockResolvedValue([])
    listGarments.mockResolvedValue({ garments: [], productsWithoutBlueprint: 0 })
    expect(await listAdminGarmentSetup()).toEqual({
      status: "ready",
      categories: [],
      garments: [],
      productsWithoutBlueprint: 0,
    })
  })

  // Merging does not push migrations here, so "relation does not exist" is a state the pages must
  // draw rather than a 500. One failed read fails the whole answer: garments whose categories
  // could not be read would offer the owner an empty dropdown.
  it.each([
    ["the categories", () => listCategories.mockRejectedValue(new Error("private database host"))],
    ["the garments", () => listGarments.mockRejectedValue(new Error("private database host"))],
    [
      "both, as an unpushed migration would",
      () => {
        listCategories.mockRejectedValue(new Error('relation "commerce.shop_categories" on private database host'))
        listGarments.mockRejectedValue(new Error('relation "commerce.garment_models" on private database host'))
      },
    ],
  ])("reports unavailable without the details when the store cannot read %s", async (_label, fail) => {
    fail()
    expect(await listAdminGarmentSetup()).toEqual({ status: "unavailable" })
    expect(console.warn).toHaveBeenCalledWith("Garment setup unavailable", { reason: "storage" })
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("private database host")
  })

  it("reports unavailable when publishing storage is not configured at all", async () => {
    getPublishingStore.mockImplementation(() => {
      throw new Error("Publishing storage is not configured")
    })
    expect(await listAdminGarmentSetup()).toEqual({ status: "unavailable" })
    expect(console.warn).toHaveBeenCalledWith("Garment setup unavailable", { reason: "storage" })
  })
})
