import { beforeEach, describe, expect, it, vi } from "vitest"

const key = "your-store-visit-source-v1"

async function source() {
  return (await import("./get-store-visit-source")).getStoreVisitSource()
}

describe("store visit attribution", () => {
  beforeEach(() => {
    vi.resetModules()
    sessionStorage.clear()
    window.history.replaceState(null, "", "/shop")
    vi.spyOn(document, "referrer", "get").mockReturnValue("")
  })

  it.each([
    ["https://www.google.com/search?q=graphic+shirts", "organic_search"],
    ["https://www.google.co.uk/search?q=shirts", "organic_search"],
    ["https://www.bing.com/search?q=shirts", "organic_search"],
    ["https://l.instagram.com/", "social"],
    ["https://community.example/members?email=private@example.com", "referral"],
    ["https://checkout.stripe.com/c/pay/private", "direct"],
    ["", "direct"],
  ])("classifies %s without retaining its raw URL", async (referrer, expected) => {
    vi.spyOn(document, "referrer", "get").mockReturnValue(referrer)
    expect(await source()).toBe(expected)
    expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual({ source: expected, createdAt: expect.any(Number) })
    expect(sessionStorage.getItem(key)).not.toContain("?")
  })

  it("preserves the original search source across a Stripe return and subsequent page loads", async () => {
    vi.spyOn(document, "referrer", "get").mockReturnValue("https://www.google.com/")
    expect(await source()).toBe("organic_search")
    vi.resetModules()
    window.history.replaceState(null, "", "/checkout/success?session_id=cs_live_private")
    vi.spyOn(document, "referrer", "get").mockReturnValue("https://checkout.stripe.com/")
    expect(await source()).toBe("organic_search")
    expect(sessionStorage.getItem(key)).not.toContain("cs_live")
  })

  it("classifies campaign mediums without retaining campaign names or mistaking paid search for organic", async () => {
    window.history.replaceState(null, "", "/shop?utm_medium=cpc&utm_campaign=private-campaign")
    vi.spyOn(document, "referrer", "get").mockReturnValue("https://google.com/")
    expect(await source()).toBe("paid")
    expect(sessionStorage.getItem(key)).not.toContain("private")
  })

  it("recognizes search ad click identifiers without retaining their values", async () => {
    window.history.replaceState(null, "", "/shop?gclid=private-ad-click")
    vi.spyOn(document, "referrer", "get").mockReturnValue("https://google.com/")
    expect(await source()).toBe("paid")
    expect(sessionStorage.getItem(key)).not.toContain("private-ad-click")
  })

  it.each(["facebook", "instagram", "meta_shops"])(
    "classifies a %s cart handoff without a referrer and preserves it across Stripe",
    async (cartOrigin) => {
      window.history.replaceState(
        null,
        "",
        `/checkout/meta?products=shirt%3A2&cart_origin=${cartOrigin}&fbclid=private-click`
      )
      expect(await source()).toBe("social")
      expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual({ source: "social", createdAt: expect.any(Number) })
      vi.resetModules()
      window.history.replaceState(null, "", "/checkout/success?session_id=cs_live_private")
      vi.spyOn(document, "referrer", "get").mockReturnValue("https://checkout.stripe.com/")
      expect(await source()).toBe("social")
    }
  )

  it.each(["", "other", "facebook.example"])(
    "does not infer a channel from an unknown cart origin %s",
    async (origin) => {
      window.history.replaceState(null, "", `/checkout/meta?cart_origin=${origin}`)
      expect(await source()).toBe("direct")
    }
  )

  it.each([
    ["gclid=private-click", "paid"],
    ["utm_medium=paid_social", "paid"],
    ["utm_medium=email", "email"],
    ["utm_medium=organic", "organic_search"],
  ])("keeps explicit campaign attribution %s ahead of Meta's cart origin", async (campaign, expected) => {
    window.history.replaceState(null, "", `/checkout/meta?cart_origin=instagram&${campaign}`)
    expect(await source()).toBe(expected)
  })

  it("preserves an existing visit source when that visit opens a Meta cart", async () => {
    vi.spyOn(document, "referrer", "get").mockReturnValue("https://google.com/")
    expect(await source()).toBe("organic_search")
    window.history.replaceState(null, "", "/checkout/meta?cart_origin=instagram")
    vi.spyOn(document, "referrer", "get").mockReturnValue("")
    expect(await source()).toBe("organic_search")
    vi.resetModules()
    expect(await source()).toBe("organic_search")
  })

  it("expires the in-memory source even when the same page stays open beyond 24 hours", async () => {
    const start = Date.now()
    vi.spyOn(Date, "now").mockReturnValue(start)
    vi.spyOn(document, "referrer", "get").mockReturnValue("https://google.com/")
    expect(await source()).toBe("organic_search")
    vi.spyOn(Date, "now").mockReturnValue(start + 25 * 60 * 60 * 1000)
    window.history.replaceState(null, "", "/shop?utm_medium=email")
    expect(await source()).toBe("email")
    expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual({
      source: "email",
      createdAt: start + 25 * 60 * 60 * 1000,
    })
  })

  it.each([
    "corrupt",
    JSON.stringify({ source: "private arbitrary source", createdAt: Date.now() }),
    JSON.stringify({ source: "organic_search", createdAt: Date.now() - 25 * 60 * 60 * 1000 }),
    JSON.stringify({ source: "organic_search", createdAt: Date.now() + 60_000 }),
  ])("discards malformed or expired attribution", async (saved) => {
    sessionStorage.setItem(key, saved)
    expect(await source()).toBe("direct")
  })

  it("keeps working if browser storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Blocked")
    })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Blocked")
    })
    vi.spyOn(document, "referrer", "get").mockReturnValue("https://www.google.com/")
    expect(await source()).toBe("organic_search")
    expect(await source()).toBe("organic_search")
  })

  it("preserves a handoff's coarse source after URL cleanup when tab storage is blocked", async () => {
    const createdAt = Date.now() - 1000
    window.history.replaceState(
      { storeCheckoutRecovery: { kind: "meta", selector: "a".repeat(32), visit: { source: "social", createdAt } } },
      "",
      "/checkout/meta"
    )
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Blocked")
    })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Blocked")
    })
    expect(await source()).toBe("social")
    vi.resetModules()
    expect(await source()).toBe("social")
    expect(window.location.search).toBe("")
  })

  it("replaces malformed tab storage with the handoff's bounded coarse source", async () => {
    const visit = { source: "social", createdAt: Date.now() - 1000 }
    window.history.replaceState(
      { storeCheckoutRecovery: { kind: "meta", selector: "a".repeat(32), visit } },
      "",
      "/checkout/meta"
    )
    sessionStorage.setItem(key, "corrupt")
    expect(await source()).toBe("social")
    expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(visit)
  })

  it("keeps a valid prior tab source ahead of the handoff fallback and ignores expired fallback", async () => {
    const createdAt = Date.now()
    window.history.replaceState(
      { storeCheckoutRecovery: { kind: "meta", selector: "a".repeat(32), visit: { source: "social", createdAt } } },
      "",
      "/checkout/meta"
    )
    sessionStorage.setItem(key, JSON.stringify({ source: "organic_search", createdAt }))
    expect(await source()).toBe("organic_search")
    vi.resetModules()
    sessionStorage.clear()
    window.history.replaceState(
      { storeCheckoutRecovery: { visit: { source: "social", createdAt: createdAt - 25 * 60 * 60 * 1000 } } },
      "",
      "/checkout/meta"
    )
    expect(await source()).toBe("direct")
  })
})
