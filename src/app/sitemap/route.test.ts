import { beforeEach, describe, expect, it, vi } from "vitest"

import { storeConfig } from "@/lib/store-config"
import { getSitemapProducts, type SitemapProduct } from "@/features/catalog/get-sitemap-products.server"

import { GET } from "./route"

vi.mock("@/features/catalog/get-sitemap-products.server", () => ({ getSitemapProducts: vi.fn() }))
vi.mock("@/lib/get-site-url", () => ({ getSiteUrl: () => new URL("https://store.example") }))
const config = vi.hoisted(() => ({ indexable: true }))
vi.mock("@/lib/is-indexable-site", () => ({ isIndexableSite: () => config.indexable }))
beforeEach(() => {
  storeConfig.features.about = true
  vi.clearAllMocks()
  config.indexable = true
})

const sitemapNamespace = "http://www.sitemaps.org/schemas/sitemap/0.9"
const imageNamespace = "http://www.google.com/schemas/sitemap-image/1.1"

function product(id: string, changes: Partial<SitemapProduct> = {}): SitemapProduct {
  return { id, title: `Tee ${id}`, lastModified: null, image: null, ...changes }
}

async function parse(response: Response) {
  const xml = new DOMParser().parseFromString(await response.text(), "application/xml")
  expect(xml.querySelector("parsererror")).toBeNull()
  return xml
}

describe("sitemap response", () => {
  it("returns canonical public pages and deduplicated products as valid XML", async () => {
    vi.mocked(getSitemapProducts).mockResolvedValue([product("tee"), product("tee"), product("a&b")])
    const response = await GET()
    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toContain("application/xml")
    const xml = await parse(response)
    expect([...xml.getElementsByTagNameNS(sitemapNamespace, "loc")].map((node) => node.textContent)).toEqual([
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
    expect(xml.getElementsByTagNameNS(imageNamespace, "image")).toHaveLength(0)
  })
  it("dates products by their shop arrival and lists their default photo", async () => {
    vi.mocked(getSitemapProducts).mockResolvedValue([
      product("tee", {
        lastModified: "2026-09-14T12:00:00+02:00",
        image: "https://images.example/tee.jpg?size=large&view=front",
      }),
      product("undated", { lastModified: "not a date" }),
    ])
    const xml = await parse(await GET())
    const urls = [...xml.getElementsByTagNameNS(sitemapNamespace, "url")]
    const tee = urls.find((url) => url.textContent?.includes("/shop/tee"))!
    expect(tee.getElementsByTagNameNS(sitemapNamespace, "lastmod")[0]?.textContent).toBe("2026-09-14T10:00:00.000Z")
    expect(tee.getElementsByTagNameNS(imageNamespace, "loc")[0]?.textContent).toBe(
      "https://images.example/tee.jpg?size=large&view=front"
    )
    const undated = urls.find((url) => url.textContent?.includes("/shop/undated"))!
    expect(undated.getElementsByTagNameNS(sitemapNamespace, "lastmod")).toHaveLength(0)
    expect(undated.getElementsByTagNameNS(imageNamespace, "image")).toHaveLength(0)
    // Static pages carry no date: nothing records when their copy last changed.
    expect(urls[0]!.getElementsByTagNameNS(sitemapNamespace, "lastmod")).toHaveLength(0)
  })
  it("returns an uncached retryable503 when catalog reads fail, without leaking provider errors", async () => {
    vi.mocked(getSitemapProducts).mockRejectedValue(new Error("private provider failure"))
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
    expect(getSitemapProducts).not.toHaveBeenCalled()
  })
})

it("omits the disabled About page from discovery", async () => {
  storeConfig.features.about = false
  vi.mocked(getSitemapProducts).mockResolvedValue([])
  const response = await GET()
  expect(response.status).toBe(200)
  expect(await response.text()).not.toContain("/about")
})
