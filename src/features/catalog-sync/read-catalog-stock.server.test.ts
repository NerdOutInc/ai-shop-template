import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { readCatalogObservation } from "./read-catalog-observation.server"
import { readCatalogStock } from "./read-catalog-stock.server"
vi.mock("server-only", () => ({}))
vi.mock("./read-catalog-observation.server", () => ({ readCatalogObservation: vi.fn() }))
const read = vi.mocked(readCatalogObservation)
const fetchMock = vi.fn()
const payload = {
  fingerprintVersion: "v2",
  products: { shirt: [{ id: 1, enabled: true, inStock: true, fingerprint: "v2:sample" }] },
}
beforeEach(() => {
  read.mockResolvedValue({ payload, observedAt: Date.now() })
  vi.stubGlobal("fetch", fetchMock)
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
})
afterEach(() => {
  expect(fetchMock).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})
it("returns fresh stored eligibility without calling Printify", async () => {
  expect(await readCatalogStock()).toEqual(payload.products)
})
it.each([
  null,
  { payload, observedAt: Date.now() - 7_200_000 },
  { payload, observedAt: Date.now() + 60_000 },
  { payload: { ...payload, fingerprintVersion: "v1" }, observedAt: Date.now() },
  { payload: { ...payload, products: { shirt: [{ id: 1 }] } }, observedAt: Date.now() },
])("fails closed for unusable observations", async (row) => {
  read.mockResolvedValue(row)
  expect(await readCatalogStock()).toBeNull()
})
it("does not try Printify when storage fails", async () => {
  read.mockRejectedValue(new Error("private database error"))
  expect(await readCatalogStock()).toBeNull()
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("private database error")
})

it("uses a newer publication's live stock until the next scan, without extending a stale scan", async () => {
  const now = Date.now()
  const variants = [{ id: 1, enabled: true, inStock: true, fingerprint: "v2:new-design" }]
  const snapshot = {
    id: "shirt",
    storefront_stock: { fingerprintVersion: "v2", observedAt: now - 30_000, products: { shirt: variants } },
  }
  read.mockResolvedValue({ payload: { fingerprintVersion: "v2", products: {} }, observedAt: now - 60_000 })
  expect(await readCatalogStock([snapshot])).toEqual({ shirt: variants })
  read.mockResolvedValue({ payload, observedAt: now - 60_000 })
  expect(await readCatalogStock([snapshot])).toEqual({ shirt: variants })
  read.mockResolvedValue({ payload, observedAt: now })
  expect(await readCatalogStock([snapshot])).toEqual(payload.products)
  read.mockResolvedValue({ payload, observedAt: now - 7_200_000 })
  expect(await readCatalogStock([snapshot])).toBeNull()
})
it.each(["future", "old-version", "invalid", "other-product"])("ignores %s publication stock", async (fault) => {
  const now = Date.now()
  read.mockResolvedValue({ payload, observedAt: now - 60_000 })
  const published = {
    ...payload,
    products: fault === "other-product" ? { other: [] } : { shirt: [] },
    observedAt: fault === "future" ? now + 60_000 : now - 30_000,
    fingerprintVersion: fault === "old-version" ? "v1" : "v2",
  }
  expect(await readCatalogStock([{ id: "shirt", storefront_stock: fault === "invalid" ? {} : published }])).toEqual(
    payload.products
  )
})
