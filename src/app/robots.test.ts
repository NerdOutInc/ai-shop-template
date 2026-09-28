import { describe, expect, it, vi } from "vitest"

import robots from "./robots"

vi.mock("@/lib/get-site-url", () => ({ getSiteUrl: () => new URL("https://store.example") }))
const config = vi.hoisted(() => ({ indexable: true }))
vi.mock("@/lib/is-indexable-site", () => ({ isIndexableSite: () => config.indexable }))

describe("crawler instructions", () => {
  it("advertises the sitemap without blocking pages that use noindex", () => {
    config.indexable = true
    expect(robots()).toEqual({
      rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/admin", "/auth/"] },
      sitemap: "https://store.example/sitemap.xml",
    })
  })
  it("does not advertise a preview sitemap", () => {
    config.indexable = false
    expect(robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } })
  })
})
