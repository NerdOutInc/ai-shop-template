import { beforeEach, describe, expect, it, vi } from "vitest"

import type { CatalogProduct, CatalogResult } from "@/features/catalog/catalog-product"
import { getCatalog } from "@/features/catalog/get-catalog.server"

import { readDropEmailProducts } from "./read-drop-email-products.server"

vi.mock("server-only", () => ({}))
vi.mock("@/features/catalog/get-catalog.server", () => ({ getCatalog: vi.fn() }))

const week = { liveAt: "2026-10-05T09:00:00.000Z", productIds: ["tee", "crop", "sold-out"] }
const product = (id: string, availability: CatalogProduct["availability"] = "available"): CatalogProduct => ({
  id,
  title: `Abstract Lines - ${id}`,
  description: "",
  addedToShopAt: null,
  salesCount: 0,
  image: null,
  images: [],
  price: { currency: "USD", min: 3000, max: 3000 },
  options: [],
  variants: [],
  colors: [],
  sizeGuide: null,
  availability,
})
const catalog = (overrides: Partial<CatalogResult> = {}): CatalogResult => ({
  status: "ready",
  products: [product("older"), product("crop"), product("tee"), product("sold-out", "unavailable")],
  designOfTheWeekProductIds: ["crop", "tee", "sold-out"],
  ...overrides,
})

beforeEach(() => {
  vi.mocked(getCatalog).mockReset()
})

describe("readDropEmailProducts", () => {
  it("is the home page's roster in shop order, leaving out what nobody can buy right now", async () => {
    vi.mocked(getCatalog).mockResolvedValue(catalog())
    expect((await readDropEmailProducts(week))?.map((item) => item.id)).toEqual(["crop", "tee"])
    // Read against the same week, so the email and the home page cannot disagree about a boundary.
    expect(getCatalog).toHaveBeenCalledWith({ productWeek: week })
  })

  it("answers 'could not tell' for a catalog that failed, even partly, because the email is frozen once", async () => {
    vi.mocked(getCatalog).mockResolvedValue(catalog({ status: "partial" }))
    expect(await readDropEmailProducts(week)).toBeNull()
    vi.mocked(getCatalog).mockResolvedValue(catalog({ status: "unavailable", products: [] }))
    expect(await readDropEmailProducts(week)).toBeNull()
  })

  it("finds nothing to announce when none of the week's products are in the shop", async () => {
    vi.mocked(getCatalog).mockResolvedValue(catalog({ designOfTheWeekProductIds: [] }))
    expect(await readDropEmailProducts(week)).toEqual([])
  })
})
