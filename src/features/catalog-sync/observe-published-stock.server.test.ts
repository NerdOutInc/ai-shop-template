import { expect, it, vi } from "vitest"
import { createCatalogFixture } from "../../../test/create-catalog-fixture"
import { observePublishedStock } from "./observe-published-stock.server"
vi.mock("server-only", () => ({}))
it("captures only stock and production hashes from the live publication read", () => {
  const live = createCatalogFixture()
  const result = observePublishedStock(live, { productId: "shirt", shopId: "123" }, 12345)
  expect(result).toMatchObject({ observedAt: 12345, fingerprintVersion: "v2", products: { shirt: expect.any(Array) } })
  expect(result.products.shirt).toHaveLength(3)
  expect(JSON.stringify(result)).not.toMatch(/price|title|private-artwork|print_areas/)
})
it("keeps a malformed Show draft unavailable without importing its data", () => {
  const live = { ...createCatalogFixture(), print_areas: [] }
  expect(observePublishedStock(live, { productId: "shirt", shopId: "123" }, 12345).products.shirt).toEqual([])
})
