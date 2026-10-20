import { beforeEach, describe, expect, it, vi } from "vitest"

import { storeConfig } from "@/lib/store-config"

import robots from "./robots"

vi.mock("@/lib/get-site-url", () => ({ getSiteUrl: () => new URL("https://store.example") }))
const config = vi.hoisted(() => ({ indexable: true }))
vi.mock("@/lib/is-indexable-site", () => ({ isIndexableSite: () => config.indexable }))

const aiCrawlers = [
  "GPTBot",
  "OAI-SearchBot",
  "ClaudeBot",
  "Claude-SearchBot",
  "PerplexityBot",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
]
const allow = ["/", "/api/catalog", "/llms.txt"]
const disallow = ["/api/", "/admin", "/auth/", "/checkout/", "/feeds/"]

beforeEach(() => {
  config.indexable = true
  storeConfig.seo.aiCrawlers = "allow"
})

describe("crawler instructions", () => {
  it("advertises the sitemap and the agent surfaces without blocking pages that use noindex", () => {
    expect(robots()).toEqual({
      rules: [
        { userAgent: "*", allow, disallow },
        { userAgent: aiCrawlers, allow, disallow },
      ],
      sitemap: "https://store.example/sitemap.xml",
    })
  })
  it("blocks only the named AI crawlers when the owner opts out", () => {
    storeConfig.seo.aiCrawlers = "block"
    expect(robots().rules).toEqual([
      { userAgent: "*", allow, disallow },
      { userAgent: aiCrawlers, disallow: "/" },
    ])
  })
  it("does not advertise a preview sitemap", () => {
    config.indexable = false
    expect(robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } })
  })
})
