import { expect, it } from "vitest"

import { sanitizeAnalyticsEvent } from "./sanitize-analytics-event"

it.each(["/checkout/meta", "/checkout/meta/", "/shop"])(
  "removes private cart and checkout parameters from pageviews and events on %s",
  (pathname) => {
    for (const type of ["pageview", "event"] as const) {
      const result = sanitizeAnalyticsEvent({
        type,
        url: `https://example.com${pathname}?products=shirt%3A2&%70roducts=shirt%3A1&coupon=private-offer&%63oupon=other&session_id=private&utm_source=instagram`,
      })
      expect(result?.url).toBe(`https://example.com${pathname}?utm_source=instagram`)
    }
  }
)

// The signup form posts, so these should never appear; this is the belt to that pair of braces.
it("removes a drop signup address, and its honeypot, from a URL that somehow carries them", () => {
  for (const type of ["pageview", "event"] as const) {
    const result = sanitizeAnalyticsEvent({
      type,
      url: "https://example.com/design-of-the-week?email=shopper%40example.com&%65mail=other%40example.com&company=&utm_source=instagram",
    })
    expect(result?.url).toBe("https://example.com/design-of-the-week?utm_source=instagram")
  }
})

it("drops events whose URL cannot be sanitized", () => {
  expect(sanitizeAnalyticsEvent({ type: "pageview", url: "invalid URL" })).toBeNull()
})

it.each(["/admin", "/admin/setup", "/admin/concepts/149", "/auth/callback", "/api/admin/assets/a"])(
  "drops private pageviews and events on %s, including a previously initialized storefront SDK",
  (pathname) => {
    for (const type of ["pageview", "event"] as const) {
      expect(sanitizeAnalyticsEvent({ type, url: `https://example.com${pathname}?code=secret` })).toBeNull()
    }
  }
)
