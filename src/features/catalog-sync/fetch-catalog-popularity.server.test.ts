import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { fetchCatalogPopularity } from "./fetch-catalog-popularity.server"

vi.mock("server-only", () => ({}))
const fetchMock = vi.fn<typeof fetch>()
const config = { apiToken: "private-token", shopId: "1234" }
function order(id: string, productId: string, quantity: number, status = "fulfilled") {
  return { id, status, line_items: [{ product_id: productId, quantity, status }] }
}
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("background popularity scan", () => {
  it("sums quantities across every page, excludes canceled, unpaid, reprint and sample orders, and retains totals for products that may be re-shown", async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          current_page: 1,
          last_page: 2,
          total: 8,
          data: [order("one", "shirt", 3), order("two", "other", 100), order("three", "shirt", 10, "canceled")],
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          current_page: 2,
          last_page: 2,
          total: 8,
          data: [
            order("four", "shirt", 2, "in-production"),
            order("five", "shirt", 20, "payment-not-received"),
            { ...order("six", "shirt", 20), metadata: { is_reprint: true } },
            { ...order("seven", "shirt", 20), metadata: { order_type: "sample" } },
            order("eight", "shirt", 10, "on-hold"),
          ],
        })
      )
    expect(await fetchCatalogPopularity(config.apiToken, config.shopId, ["shirt", "no-sales"])).toEqual({
      shirt: 5,
      other: 100,
      "no-sales": 0,
    })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://api.printify.com/v1/shops/1234/orders.json?limit=10&page=1",
      "https://api.printify.com/v1/shops/1234/orders.json?limit=10&page=2",
    ])
  })

  it("deduplicates order ids and rejects an incomplete paginated snapshot", async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({ current_page: 1, last_page: 2, total: 2, data: [order("one", "shirt", 3)] })
      )
      .mockResolvedValueOnce(
        Response.json({ current_page: 2, last_page: 2, total: 2, data: [order("one", "shirt", 3)] })
      )
    await expect(fetchCatalogPopularity(config.apiToken, config.shopId, ["shirt"])).rejects.toThrow()
  })

  it("fails the entire aggregate if a later page fails, without publishing partial or zero counts", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ current_page: 1, last_page: 2, data: [order("one", "shirt", 3)] }))
      .mockResolvedValueOnce(new Response("private order contents", { status: 403 }))
    await expect(fetchCatalogPopularity(config.apiToken, config.shopId, ["shirt"])).rejects.toThrow()
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(/private-token|private order contents/)
  })

  it("counts only produced lines in a partially fulfilled order", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        current_page: 1,
        last_page: 1,
        data: [
          {
            id: "one",
            status: "partially-fulfilled",
            line_items: [
              { product_id: "shirt", quantity: 2, status: "fulfilled" },
              { product_id: "shirt", quantity: 5, status: "canceled" },
            ],
          },
        ],
      })
    )
    expect(await fetchCatalogPopularity(config.apiToken, config.shopId, ["shirt"])).toEqual({ shirt: 2 })
  })

  it("accepts a truly empty shop as zero sales", async () => {
    fetchMock.mockResolvedValue(Response.json({ current_page: 1, last_page: 0, total: 0, data: [] }))
    expect(await fetchCatalogPopularity(config.apiToken, config.shopId, ["shirt"])).toEqual({ shirt: 0 })
  })

  it("continues until a short final page when optional pagination metadata is absent", async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({ current_page: 1, data: Array.from({ length: 10 }, (_, i) => order(String(i), "shirt", 1)) })
      )
      .mockResolvedValueOnce(Response.json({ current_page: 2, data: [order("last", "shirt", 4)] }))
    expect(await fetchCatalogPopularity(config.apiToken, config.shopId, ["shirt"])).toEqual({ shirt: 14 })
  })

  it("stops oversized histories without claiming a partial ranking is complete", async () => {
    fetchMock.mockImplementation(async (input) => {
      const page = Number(new URL(String(input)).searchParams.get("page"))
      return Response.json({ current_page: page, last_page: 201, data: [order(String(page), "shirt", 1)] })
    })
    await expect(fetchCatalogPopularity(config.apiToken, config.shopId, ["shirt"])).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(200)
  })
})
