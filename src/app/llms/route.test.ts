import { beforeEach, describe, expect, it, vi } from "vitest"

import { storeConfig } from "@/lib/store-config"
import { getAgentCatalog } from "@/features/agent-catalog/get-agent-catalog.server"
import { createAgentCatalog } from "@/features/agent-catalog/create-agent-catalog"
import { normalizeCatalogProduct } from "@/features/catalog/normalize-catalog-product"
import { galleryProductFixture } from "../../../test/gallery-product-fixture"

import { GET } from "./route"

vi.mock("@/features/agent-catalog/get-agent-catalog.server", () => ({ getAgentCatalog: vi.fn() }))
vi.mock("@/lib/get-site-url", () => ({ getSiteUrl: () => new URL("https://store.example") }))
const config = vi.hoisted(() => ({ indexable: true, PRINTIFY_PUBLISHING_ENABLED: true }))
vi.mock("@/lib/is-indexable-site", () => ({ isIndexableSite: () => config.indexable }))
vi.mock("@/lib/env", () => ({ env: config }))
beforeEach(() => {
  storeConfig.features.about = true
  config.PRINTIFY_PUBLISHING_ENABLED = true
  config.indexable = true
})

describe("llms.txt", () => {
  it("describes the store, its policies, the catalog endpoint and every agent-catalog product", async () => {
    vi.mocked(getAgentCatalog).mockResolvedValue(
      createAgentCatalog(
        [
          { id: "tee", title: "Friday [Tee]\nSecond line" },
          { id: "a&b", title: "Ampersand" },
        ].map((identity) => ({
          product: normalizeCatalogProduct({ ...galleryProductFixture(), ...identity }),
          category: null,
        })),
        new URL("https://store.example")
      )
    )
    const response = await GET()
    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8")
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=0, s-maxage=300")
    const text = await response.text()
    expect(text.startsWith(`# Fixture Store\n\n> ${storeConfig.description}\n`)).toBe(true)
    for (const line of [
      "- [Shop](https://store.example/shop)",
      "- [Product catalog (JSON)](https://store.example/api/catalog)",
      "- [Sitemap](https://store.example/sitemap.xml)",
      "- [About](https://store.example/about)",
      "- [Shipping](https://store.example/shipping)",
      "- [Returns](https://store.example/returns)",
      "- [Privacy](https://store.example/privacy)",
      "- [Friday \\[Tee\\] Second line](https://store.example/shop/tee)",
      "- [Ampersand](https://store.example/shop/a%26b)",
    ]) {
      expect(text).toContain(line)
    }
    expect(text.split("## Products")[1]).not.toContain("about")
  })
  it("omits the disabled About page", async () => {
    storeConfig.features.about = false
    vi.mocked(getAgentCatalog).mockResolvedValue(createAgentCatalog([], new URL("https://store.example")))
    expect(await (await GET()).text()).not.toContain("/about")
  })
  it("returns an uncached retryable 503 when catalog reads fail, without leaking provider errors", async () => {
    vi.mocked(getAgentCatalog).mockRejectedValue(new Error("private provider failure"))
    const response = await GET()
    expect(response.status).toBe(503)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(response.headers.get("Retry-After")).toBe("300")
    expect(await response.text()).toBe("llms.txt temporarily unavailable")
  })
  it("is absent on previews and unconfigured stores without querying the catalog", async () => {
    config.indexable = false
    const response = await GET()
    expect(response.status).toBe(404)
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex")
    expect(getAgentCatalog).not.toHaveBeenCalled()
    config.indexable = true
    config.PRINTIFY_PUBLISHING_ENABLED = false
    expect((await GET()).status).toBe(404)
    expect(getAgentCatalog).not.toHaveBeenCalled()
  })
})
