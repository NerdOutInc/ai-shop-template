import { describe, expect, it } from "vitest"

import { buildOrderAttribution } from "./build-order-attribution"

const now = Date.parse("2026-09-21T10:00:00.000Z")

describe("bounded first-party order attribution", () => {
  it.each([
    ["https://www.google.com/search?q=private", "organic_search", "google", "www.google.com"],
    ["https://www.google.co.uk/search?q=private", "organic_search", "google", "www.google.co.uk"],
    ["https://l.instagram.com/?private=1", "social", "instagram", "l.instagram.com"],
    ["https://gym.example/members/private?email=a@example.com", "referral", "gym.example", "gym.example"],
    ["https://checkout.stripe.com/c/pay/private", "direct", null, null],
    ["https://example.com/cart?private=1", "direct", null, null],
    ["not a URL", "direct", null, null],
    ["https://user:password@gym.example/private", "direct", null, null],
    ["", "direct", null, null],
  ])("keeps only the source website from %s", (referrer, channel, source, referrerHost) => {
    expect(buildOrderAttribution(new URL("https://example.com/shop?color=Black#size"), referrer, now)).toEqual({
      version: 1,
      capturedAt: "2026-09-21T10:00:00.000Z",
      channel,
      source,
      referrerHost,
      landingPath: "/shop",
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      method: referrerHost ? "referrer" : "direct",
    })
  })

  it("prefers explicit campaign source and medium over a referring site", () => {
    expect(
      buildOrderAttribution(
        new URL("https://example.com/shop?utm_source=Instagram&utm_medium=paid_social&utm_campaign=Fall_2026"),
        "https://google.com/search?q=private",
        now
      )
    ).toMatchObject({
      channel: "paid",
      source: "instagram",
      referrerHost: "google.com",
      utmSource: "Instagram",
      utmMedium: "paid_social",
      utmCampaign: "Fall_2026",
      method: "campaign",
    })
  })

  it.each([
    ["gclid", "google"],
    ["dclid", "google"],
    ["msclkid", "bing"],
  ])("recognizes %s without retaining the click identifier", (key, source) => {
    const attribution = buildOrderAttribution(new URL(`https://example.com/?${key}=SECRET_CLICK_ID`), "", now)
    expect(attribution).toMatchObject({ channel: "paid", source, method: "campaign" })
    expect(JSON.stringify(attribution)).not.toContain("SECRET")
  })

  it.each(["someone@example.com", "https://private.example", "a/b", "a.b", "word word", "x".repeat(81)])(
    "drops a campaign label containing unsafe or excessive data: %s",
    (value) => {
      const url = new URL("https://example.com/shop")
      for (const key of ["utm_source", "utm_medium", "utm_campaign"]) url.searchParams.set(key, value)
      expect(buildOrderAttribution(url, "", now)).toMatchObject({
        source: null,
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
      })
    }
  )

  it.each([
    "/admin",
    "/auth/callback",
    "/api/admin/orders",
    "/checkout/success?session_id=cs_private",
    "/someones-private-page",
    "/shop/customer%40example.com",
    "/shop/product?session_id=cs_private",
    "/shop/product?coupon=private",
  ])("does not create an arrival record for %s", (path) => {
    expect(buildOrderAttribution(new URL(path, "https://example.com"), "https://google.com/", now)).toBeUndefined()
  })

  it.each(["facebook", "instagram", "meta_shops"])("recognizes a known %s selection handoff", (source) => {
    const attribution = buildOrderAttribution(
      new URL(`https://example.com/checkout/meta?products=SECRET&cart_origin=${source}`),
      "",
      now
    )
    expect(attribution).toMatchObject({
      source,
      channel: "social",
      method: "meta_checkout",
      landingPath: "/checkout/meta",
    })
    expect(JSON.stringify(attribution)).not.toContain("SECRET")
  })

  it("does not guess a platform from an unrecognized Meta source", () => {
    expect(
      buildOrderAttribution(new URL("https://example.com/checkout/meta?cart_origin=private.example"), "", now)
    ).toBeUndefined()
  })
})
