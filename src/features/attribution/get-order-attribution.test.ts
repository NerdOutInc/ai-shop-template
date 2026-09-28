import { beforeEach, describe, expect, it, vi } from "vitest"

import { checkoutRecoveryHistoryKey } from "@/features/checkout/checkout-recovery-history-key"

const { meta, google } = vi.hoisted(() => ({
  meta: { consent: "unknown" },
  google: { consent: "unknown" },
}))
vi.mock("@/features/analytics/meta-pixel", () => ({ metaPixel: { getSnapshot: () => meta } }))
vi.mock("@/features/analytics/google-tag", () => ({ googleTag: { getSnapshot: () => google } }))

const key = "your-store-order-attribution-v1"
const now = Date.parse("2026-09-21T10:00:00.000Z")

async function attribution() {
  return (await import("./get-order-attribution")).getOrderAttribution()
}

describe("order attribution across a shopping visit", () => {
  beforeEach(() => {
    vi.resetModules()
    sessionStorage.clear()
    localStorage.clear()
    window.history.replaceState(null, "", "/shop?utm_source=instagram&utm_medium=social&utm_campaign=Autumn")
    vi.spyOn(document, "referrer", "get").mockReturnValue("https://l.instagram.com/?private=1")
    vi.spyOn(Date, "now").mockReturnValue(now)
    Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value: false })
    meta.consent = "unknown"
    google.consent = "unknown"
  })

  it("captures first touch with Google and Meta unconfigured and preserves it across browsing and a Stripe return", async () => {
    const first = await attribution()
    expect(first).toMatchObject({ source: "instagram", utmCampaign: "Autumn", landingPath: "/shop" })
    window.history.replaceState(null, "", "/cart?utm_source=different")
    expect(await attribution()).toEqual(first)
    vi.resetModules()
    window.history.replaceState(null, "", "/checkout/success?session_id=cs_private")
    vi.spyOn(document, "referrer", "get").mockReturnValue("https://checkout.stripe.com/c/pay/private")
    expect(await attribution()).toEqual(first)
    expect(sessionStorage.getItem(key)).not.toContain("private")
  })

  it("does not invent a source for a fresh checkout return or a private page", async () => {
    window.history.replaceState(null, "", "/checkout/success?session_id=cs_private")
    expect(await attribution()).toBeUndefined()
    window.history.replaceState(null, "", "/admin/account")
    expect(await attribution()).toBeUndefined()
    expect(sessionStorage.getItem(key)).toBeNull()
  })

  it.each(["your-store-meta-consent-v1", "your-store-google-consent-v1"])(
    "clears saved attribution for an explicit denial in %s, even when tags are disabled",
    async (preferenceKey) => {
      expect(await attribution()).toBeDefined()
      localStorage.setItem(preferenceKey, JSON.stringify({ consent: "denied", expiresAt: now + 1000 }))
      expect(await attribution()).toBeUndefined()
      expect(sessionStorage.getItem(key)).toBeNull()
    }
  )

  it("honors the other provider's denial when one preference is malformed", async () => {
    localStorage.setItem("your-store-meta-consent-v1", "invalid")
    localStorage.setItem("your-store-google-consent-v1", JSON.stringify({ consent: "denied", expiresAt: now + 1000 }))
    expect(await attribution()).toBeUndefined()
  })

  it("does not turn an expired or malformed preference into an indefinite denial", async () => {
    localStorage.setItem("your-store-meta-consent-v1", JSON.stringify({ consent: "denied", expiresAt: now - 1 }))
    localStorage.setItem("your-store-google-consent-v1", JSON.stringify({ consent: "denied", expiresAt: "forever" }))
    expect(await attribution()).toBeDefined()
  })

  it("clears attribution immediately when GPC is observed", async () => {
    expect(await attribution()).toBeDefined()
    Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value: true })
    expect(await attribution()).toBeUndefined()
    expect(sessionStorage.getItem(key)).toBeNull()
  })

  it.each(["meta", "google"])("honors a memory-only %s privacy denial", async (provider) => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage unavailable")
    })
    expect(await attribution()).toBeDefined()
    if (provider === "meta") meta.consent = "denied"
    else google.consent = "denied"
    expect(await attribution()).toBeUndefined()
  })

  it("keeps a stable in-memory record when storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage unavailable")
    })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage unavailable")
    })
    const first = await attribution()
    window.history.replaceState(null, "", "/cart")
    expect(await attribution()).toEqual(first)
  })

  it("expires a record after 24 hours and discards malformed records", async () => {
    const first = await attribution()
    vi.spyOn(Date, "now").mockReturnValue(now + 24 * 60 * 60 * 1000)
    window.history.replaceState(null, "", "/cart?utm_source=newsletter&utm_medium=email")
    const next = await attribution()
    expect(next).toMatchObject({ channel: "email", source: "newsletter", landingPath: "/cart" })
    expect(next?.capturedAt).not.toBe(first?.capturedAt)
    vi.resetModules()
    sessionStorage.setItem(key, JSON.stringify({ ...next, landingPath: "/auth/private" }))
    window.history.replaceState(null, "", "/shop")
    expect(await attribution()).toMatchObject({ landingPath: "/shop" })
  })

  it("recovers only a known Meta platform after ingress cleans the selection URL", async () => {
    window.history.replaceState(
      { [checkoutRecoveryHistoryKey]: { visit: { source: "social", metaSource: "instagram", createdAt: now - 1000 } } },
      "",
      "/checkout/meta"
    )
    expect(await attribution()).toMatchObject({
      source: "instagram",
      channel: "social",
      method: "meta_checkout",
      landingPath: "/checkout/meta",
      utmCampaign: null,
      capturedAt: new Date(now - 1000).toISOString(),
    })
  })

  it("keeps a paid Meta handoff paid after its campaign parameters are removed", async () => {
    window.history.replaceState(
      { [checkoutRecoveryHistoryKey]: { visit: { source: "paid", metaSource: "instagram", createdAt: now - 1000 } } },
      "",
      "/checkout/meta"
    )
    expect(await attribution()).toMatchObject({
      source: "instagram",
      channel: "paid",
      method: "meta_checkout",
      utmCampaign: null,
    })
  })

  it.each([
    { source: "social", metaSource: "instagram.example", createdAt: now },
    { source: "social", metaSource: "instagram", createdAt: now + 1 },
    { source: "social", metaSource: "instagram", createdAt: now - 24 * 60 * 60 * 1000 },
    { source: "email", metaSource: "instagram", createdAt: now },
  ])("ignores malformed or expired recovery metadata: %j", async (visit) => {
    window.history.replaceState({ [checkoutRecoveryHistoryKey]: { visit } }, "", "/checkout/meta")
    expect(await attribution()).toBeUndefined()
  })
})
