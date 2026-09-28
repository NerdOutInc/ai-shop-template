import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { readCatalogObservation } from "@/features/catalog-sync/read-catalog-observation.server"
import { readPopularity } from "./read-popularity.server"
vi.mock("server-only", () => ({}))
vi.mock("@/features/catalog-sync/read-catalog-observation.server", () => ({ readCatalogObservation: vi.fn() }))
const read = vi.mocked(readCatalogObservation)
const fetchMock = vi.fn()
beforeEach(() => {
  read.mockResolvedValue({ payload: { shirt: 7, other: 20 }, observedAt: Date.now() })
  vi.stubGlobal("fetch", fetchMock)
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
})
afterEach(() => {
  expect(fetchMock).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})
it("reads only complete persisted counts without provider credentials or calls", async () => {
  expect(await readPopularity(["shirt"])).toEqual({ status: "ready", counts: { shirt: 7 } })
  expect(read).toHaveBeenCalledWith("popularity")
})
it.each([
  null,
  { payload: { shirt: 7 }, observedAt: 0 },
  { payload: { shirt: -1 }, observedAt: Date.now() },
  { payload: { shirt: 7 }, observedAt: Date.now() + 60_000 },
])("rejects absent, stale, or incomplete counts", async (observation) => {
  read.mockResolvedValue(observation)
  expect(await readPopularity(["shirt"])).toEqual({ status: "unavailable" })
})
it("does not manufacture zero sales during a database outage", async () => {
  read.mockRejectedValue(new Error("private database error"))
  expect(await readPopularity(["shirt"])).toEqual({ status: "unavailable" })
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("private database error")
})
it("does not need an observation for an empty published catalog", async () => {
  expect(await readPopularity([])).toEqual({ status: "ready", counts: {} })
  expect(read).not.toHaveBeenCalled()
})

it("keeps known rankings when a product joins after the complete scan", async () => {
  expect(await readPopularity(["shirt", "new", "other", "constructor"])).toEqual({
    status: "ready",
    counts: { shirt: 7, new: 0, other: 20, constructor: 0 },
  })
})
