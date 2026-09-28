import { beforeEach, describe, expect, it, vi } from "vitest"

import { getSitemapProductIds } from "@/features/catalog/get-sitemap-product-ids.server"

import { GET } from "./route"

vi.mock("@/features/catalog/get-sitemap-product-ids.server", () => ({ getSitemapProductIds: vi.fn() }))
vi.mock("@/lib/get-site-url", () => ({ getSiteUrl: () => new URL("https://store.example") }))
const config = vi.hoisted(() => ({ indexable: true }))
vi.mock("@/lib/is-indexable-site", () => ({ isIndexableSite: () => config.indexable }))
beforeEach(() => {
  vi.clearAllMocks()
  config.indexable = true
})

describe("sitemap response", () => {
  it("returns canonical public pages and deduplicated products as valid XML", async () => {
    vi.mocked(getSitemapProductIds).mockResolvedValue(["tee", "tee", "a&b"])
    const response = await GET()
    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toContain("application/xml")
    const xml = new DOMParser().parseFromString(await response.text(), "application/xml")
    expect(xml.querySelector("parsererror")).toBeNull()
    expect([...xml.querySelectorAll("loc")].map((node) => node.textContent)).toEqual([
      "https://store.example/",
      "https://store.example/about",
      "https://store.example/shop",
      "https://store.example/shipping",
      "https://store.example/returns",
      "https://store.example/privacy",
      "https://store.example/shop/tee",
      "https://store.example/shop/a%26b",
    ])
    expect(xml.querySelector("lastmod")).toBeNull()
  })
  it("returns an uncached retryable503 when catalog reads fail, without leaking provider errors", async () => {
    vi.mocked(getSitemapProductIds).mockRejectedValue(new Error("private provider failure"))
    const response = await GET()
    expect(response.status).toBe(503)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(response.headers.get("Retry-After")).toBe("300")
    expect(await response.text()).toBe("Sitemap temporarily unavailable")
  })
  it("omits sitemap data on preview deployments without querying the catalog", async () => {
    config.indexable = false
    const response = await GET()
    expect(response.status).toBe(404)
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex")
    expect(getSitemapProductIds).not.toHaveBeenCalled()
  })
})
