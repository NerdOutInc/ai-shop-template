import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { createCatalogFixture } from "../../../test/create-catalog-fixture"
import { fetchCatalogStock } from "./fetch-catalog-stock.server"
vi.mock("server-only", () => ({}))
const config = { apiToken: "private-token", shopId: "123" }
const fetchMock = vi.fn<typeof fetch>()
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
function page(data: unknown[], current = 1, last = 1, total = data.length) {
  return Response.json({ data, current_page: current, last_page: last, total })
}
it("refreshes 50 products with one request and persists only selected stock projections", async () => {
  fetchMock.mockResolvedValue(page(Array.from({ length: 50 }, (_, i) => createCatalogFixture(`shirt-${i}`))))
  const result = await fetchCatalogStock(config, ["shirt-1", "shirt-2", "missing"])
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
    "https://api.printify.com/v1/shops/123/products.json?limit=50&page=1",
    expect.objectContaining({ cache: "no-store", redirect: "error" })
  )
  expect(Object.keys(result.products)).toEqual(["shirt-1", "shirt-2", "missing"])
  expect(result.products.missing).toEqual([])
  expect(result.products["shirt-1"]?.[1]).toMatchObject({ id: 2, inStock: true, enabled: true })
  expect(JSON.stringify(result)).not.toMatch(
    /private-artwork|Published tee|description|price|print_areas|private-token/
  )
})
it("reads later pages even after all selected IDs appear, verifying complete membership", async () => {
  fetchMock
    .mockResolvedValueOnce(page([createCatalogFixture()], 1, 2, 2))
    .mockResolvedValueOnce(page([createCatalogFixture("draft")], 2, 2, 2))
  expect((await fetchCatalogStock(config, ["shirt"])).products.shirt).toHaveLength(3)
  expect(fetchMock).toHaveBeenCalledTimes(2)
})
it.each(["http", "duplicate", "total-changed", "missing", "wrong-shop", "wrong-page"])(
  "rejects a %s scan without returning partial data",
  async (fault) => {
    const first = createCatalogFixture()
    const second = createCatalogFixture("other")
    if (fault === "wrong-shop") second.shop_id = 456
    fetchMock
      .mockResolvedValueOnce(page([first], 1, 2, 2))
      .mockResolvedValueOnce(
        fault === "http"
          ? new Response("private-provider-error", { status: 503 })
          : page(
              fault === "missing" ? [] : [fault === "duplicate" ? first : second],
              fault === "wrong-page" ? 1 : 2,
              2,
              fault === "total-changed" ? 3 : 2
            )
      )
    await expect(fetchCatalogStock(config, ["shirt", "other"])).rejects.toThrow("CATALOG_STOCK_REFRESH_FAILED")
  }
)
it("does not fetch anything for an empty published catalog", async () => {
  expect((await fetchCatalogStock(config, [])).products).toEqual({})
  expect(fetchMock).not.toHaveBeenCalled()
})

it("rejects oversized scans without returning a partial result", async () => {
  fetchMock.mockImplementation(async (input) => {
    const current = Number(new URL(String(input)).searchParams.get("page"))
    return page([createCatalogFixture(`shirt-${current}`)], current, 21, 21)
  })
  await expect(fetchCatalogStock(config, ["shirt-1"])).rejects.toThrow("CATALOG_STOCK_REFRESH_FAILED")
  expect(fetchMock).toHaveBeenCalledTimes(20)
})
it("aborts stalled response bodies and does not expose provider error text", async () => {
  const cancellation = new AbortController()
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(cancellation.signal)
  const started = Promise.withResolvers<void>()
  fetchMock.mockImplementation(async (_input, init) => {
    return {
      ok: true,
      json: () =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener("abort", () => reject(new Error("private provider payload")), { once: true })
          started.resolve()
        }),
    } as unknown as Response
  })
  const result = fetchCatalogStock(config, ["shirt"])
  await started.promise
  cancellation.abort()
  await expect(result).rejects.toThrow("CATALOG_STOCK_REFRESH_FAILED")
})

it("isolates an invalid published product while retaining valid stock and sanitized diagnostics", async () => {
  const invalid = createCatalogFixture("bad")
  invalid.print_areas = []
  const log = vi.spyOn(console, "warn").mockImplementation(() => undefined)
  fetchMock.mockResolvedValue(page([createCatalogFixture(), invalid]))
  const result = await fetchCatalogStock(config, ["shirt", "bad"])
  expect(result.products.shirt).toHaveLength(3)
  expect(result.products.bad).toEqual([])
  expect(log).toHaveBeenCalledExactlyOnceWith("Catalog product stock unavailable", {
    code: "CATALOG_PRODUCT_INVALID",
    productId: "bad",
  })
})

it.each([12_000, 16_000])("handles a product page taking %i ms within the real request deadline", async (latency) => {
  vi.useFakeTimers()
  vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(new DOMException("Timeout", "TimeoutError")), milliseconds)
    return controller.signal
  })
  fetchMock.mockImplementation(
    (_input, options) =>
      new Promise((resolve, reject) => {
        options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason), { once: true })
        setTimeout(() => resolve(page([createCatalogFixture()])), latency)
      })
  )
  const result = fetchCatalogStock(config, ["shirt"])
  const checked =
    latency < 15_000
      ? expect(result).resolves.toMatchObject({ products: { shirt: expect.any(Array) } })
      : expect(result).rejects.toThrow("CATALOG_STOCK_REFRESH_FAILED")
  await vi.advanceTimersByTimeAsync(latency)
  await checked
})
