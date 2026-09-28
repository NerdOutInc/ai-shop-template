import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("store event delivery preparation", () => {
  beforeEach(() => {
    vi.resetModules()
    delete window.va
    delete window.vaq
    sessionStorage.clear()
    window.history.replaceState(null, "", "/shop")
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    document.querySelectorAll("script[data-disable-auto-track]").forEach((element) => element.remove())
    delete window.va
    delete window.vaq
  })

  it("initializes the official queue and sanitizer before the lazy analytics adapter is ready", async () => {
    const { trackStoreEvent } = await import("./track-store-event")
    expect(window.va).toBeUndefined()
    expect(trackStoreEvent({ name: "product_viewed", productId: "product-a" })).toBe(true)
    const queue = window.vaq!
    expect(queue[0]?.[0]).toBe("beforeSend")
    expect(queue[1]).toEqual([
      "event",
      { name: "product_viewed", data: { source: "direct", product_id: "product-a" }, options: undefined },
    ])
    const sanitize = queue[0]![1] as (event: { type: "event"; url: string }) => { url: string }
    expect(
      sanitize({ type: "event", url: "https://example.com/checkout/success?session_id=secret&%73ession_id=second" }).url
    ).toBe("https://example.com/checkout/success")
    trackStoreEvent({ name: "add_to_cart", productId: "product-a" })
    expect(document.querySelectorAll("script[data-disable-auto-track]")).toHaveLength(1)
  })

  it("sends only two allowed properties even when an order-like object contains extra private fields", async () => {
    const { trackStoreEvent } = await import("./track-store-event")
    const event = {
      name: "purchase" as const,
      totalUsd: 32.95,
      sessionId: "secret",
      email: "private@example.com",
      receipt: "private",
    }
    trackStoreEvent(event)
    expect(window.vaq!.at(-1)).toEqual([
      "event",
      { name: "purchase", data: { source: "direct", total_usd: 32.95 }, options: undefined },
    ])
    expect(JSON.stringify(window.vaq)).not.toContain("private")
  })

  it("contains analytics failures instead of blocking the shopping action", async () => {
    window.va = () => {
      throw new Error("Analytics unavailable")
    }
    const { trackStoreEvent } = await import("./track-store-event")
    expect(trackStoreEvent({ name: "begin_checkout", subtotalUsd: 28 })).toBe(false)
  })

  it("does not initialize tracking or attribution in the private library", async () => {
    window.history.replaceState(null, "", "/admin/concepts?token=private")
    const { trackStoreEvent } = await import("./track-store-event")
    expect(trackStoreEvent({ name: "product_viewed", productId: "private-design" })).toBe(false)
    expect(window.va).toBeUndefined()
    expect(window.vaq).toBeUndefined()
    expect(sessionStorage.length).toBe(0)
  })

  it("uses the same Vercel-injected client configuration as the Next adapter", async () => {
    vi.stubEnv("NEXT_PUBLIC_VERCEL_OBSERVABILITY_BASEPATH", "/observability")
    vi.stubEnv(
      "NEXT_PUBLIC_VERCEL_OBSERVABILITY_CLIENT_CONFIG",
      JSON.stringify({
        analytics: {
          scriptSrc: "/configured-analytics.js",
          eventEndpoint: "/configured-event",
          dsn: "test-dsn",
        },
      })
    )
    const { trackStoreEvent } = await import("./track-store-event")
    trackStoreEvent({ name: "begin_checkout", subtotalUsd: 28 })
    const script = document.querySelector<HTMLScriptElement>("script[data-disable-auto-track]")!
    expect(script.getAttribute("src")).toBe("/configured-analytics.js")
    expect(script.dataset.eventEndpoint).toBe("/configured-event")
    expect(script.dataset.endpoint).toBe("/observability/insights")
    expect(script.dataset.dsn).toBe("test-dsn")
  })
})
