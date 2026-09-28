import { beforeEach, expect, it, vi } from "vitest"
import { getCatalogSyncStore } from "./get-catalog-sync-store.server"
import { readCatalogRefreshHealth } from "./read-catalog-refresh-health.server"
vi.mock("server-only", () => ({}))
vi.mock("./get-catalog-sync-store.server", () => ({ getCatalogSyncStore: vi.fn() }))
const read = vi.fn()
beforeEach(() => {
  vi.mocked(getCatalogSyncStore).mockReturnValue({ read } as unknown as ReturnType<typeof getCatalogSyncStore>)
  read.mockImplementation(async (kind) => ({
    payload: kind === "stock" ? { fingerprintVersion: "v2", products: {} } : {},
    observed_at: new Date(),
  }))
})
it("checks durable observations without querying Printify", async () => {
  const provider = vi.spyOn(globalThis, "fetch")
  expect(await readCatalogRefreshHealth()).toEqual([])
  expect(read.mock.calls).toEqual([["stock"], ["popularity"]])
  expect(provider).not.toHaveBeenCalled()
})
it.each([
  ["stock", 65 * 60_000, "CATALOG_STOCK_STALE"],
  ["popularity", 13 * 60 * 60_000, "CATALOG_POPULARITY_STALE"],
] as const)("warns about %s before its browsing limit expires", async (kind, age, issue) => {
  const normal = read.getMockImplementation()!
  read.mockImplementation(async (requested) => ({
    ...(await normal(requested)),
    observed_at: new Date(Date.now() - (kind === requested ? age : 0)),
  }))
  expect(await readCatalogRefreshHealth()).toEqual([issue])
})
it("reports absent observations", async () => {
  read.mockResolvedValue(null)
  expect(await readCatalogRefreshHealth()).toEqual(["CATALOG_STOCK_STALE", "CATALOG_POPULARITY_STALE"])
})
it("reports invalid observations and fingerprint versions", async () => {
  read.mockImplementation(async (kind) => ({
    payload: kind === "stock" ? { fingerprintVersion: "v1", products: {} } : { shirt: -1 },
    observed_at: new Date(),
  }))
  expect(await readCatalogRefreshHealth()).toEqual(["CATALOG_STOCK_INVALID", "CATALOG_POPULARITY_INVALID"])
})
it("reports unavailable storage without exposing its error", async () => {
  read.mockRejectedValue(new Error("private database details"))
  expect(await readCatalogRefreshHealth()).toEqual(["CATALOG_REFRESH_UNAVAILABLE"])
})
