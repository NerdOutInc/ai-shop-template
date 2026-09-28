import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const consentKey = "your-store-google-consent-v1"
const purchase = {
  transaction_id: "a".repeat(64),
  currency: "USD",
  value: 30,
  shipping: 4.95,
  tax: 0,
  items: [{ item_id: "abcdef0123456789abcdef01-12345", price: 30, quantity: 1 }],
}
type TagWindow = Window & { gtag?: (...args: unknown[]) => void; dataLayer?: IArguments[] }
const target = window as TagWindow
let listeners: (() => void)[] = []

async function setup(options = {}) {
  const { googleTag } = await import("./google-tag")
  googleTag.configure({ enabled: true, tagId: "GT-TEST1234", canonicalOrigin: location.origin, ...options })
  return googleTag
}
function script() {
  return document.querySelector<HTMLScriptElement>('script[src*="googletagmanager.com"]')
}
function calls() {
  return (target.dataLayer ?? []).map((args) => Array.from(args))
}

describe("Google consent and purchase delivery", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    localStorage.clear()
    history.replaceState(null, "", "/privacy")
    delete target.gtag
    delete target.dataLayer
    Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value: false })
    const winAdd = window.addEventListener.bind(window)
    const docAdd = document.addEventListener.bind(document)
    vi.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => {
      winAdd(type, listener, options)
      listeners.push(() => window.removeEventListener(type, listener, options))
    })
    vi.spyOn(document, "addEventListener").mockImplementation((type, listener, options) => {
      docAdd(type, listener, options)
      listeners.push(() => document.removeEventListener(type, listener, options))
    })
  })
  afterEach(() => {
    listeners.forEach((remove) => remove())
    listeners = []
    document.querySelectorAll('script[src*="googletagmanager.com"]').forEach((node) => node.remove())
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })
  it("never loads for unknown consent or an existing Meta grant", async () => {
    localStorage.setItem(
      "your-store-meta-consent-v1",
      JSON.stringify({ consent: "granted", expiresAt: Date.now() + 60000 })
    )
    const tag = await setup()
    expect(tag.getSnapshot().consent).toBe("unknown")
    expect(script()).toBeNull()
    tag.setConsent("denied")
    expect(script()).toBeNull()
  })
  it("uses the documented Arguments queue and configures only after opt-in and SDK load", async () => {
    const tag = await setup()
    tag.setConsent("granted")
    expect(script()?.referrerPolicy).toBe("no-referrer")
    expect(Object.prototype.toString.call(target.dataLayer?.[0])).toBe("[object Arguments]")
    expect(calls().some((call) => call[0] === "config")).toBe(false)
    script()!.dispatchEvent(new Event("load"))
    expect(tag.getSnapshot().ready).toBe(true)
    expect(calls().find((call) => call[0] === "consent" && call[1] === "update")?.[2]).toEqual({
      ad_storage: "granted",
      analytics_storage: "granted",
      ad_user_data: "granted",
      ad_personalization: "denied",
    })
    expect(calls().find((call) => call[0] === "config")?.[2]).toMatchObject({
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    })
  })
  it("withdraws while loading without initializing or sending a purchase", async () => {
    const tag = await setup()
    tag.setConsent("granted")
    tag.setConsent("denied")
    script()!.dispatchEvent(new Event("load"))
    await tag.trackPurchase(purchase)
    expect(calls().some((call) => ["event", "config"].includes(String(call[0])))).toBe(false)
  })
  it("deduplicates purchases independently of the other measurement stores", async () => {
    localStorage.setItem(
      "your-store-purchase-attempts-v1",
      JSON.stringify([{ receipt: purchase.transaction_id, at: Date.now() }])
    )
    const tag = await setup()
    tag.setConsent("granted")
    script()!.dispatchEvent(new Event("load"))
    await tag.trackPurchase(purchase)
    await tag.trackPurchase(purchase)
    expect(calls().filter((call) => call[1] === "purchase")).toHaveLength(1)
    expect(calls().find((call) => call[1] === "purchase")?.[2]).toMatchObject(purchase)
    tag.setConsent("denied")
    await tag.trackPurchase({ ...purchase, transaction_id: "b".repeat(64) })
    expect(calls().filter((call) => call[1] === "purchase")).toHaveLength(1)
    expect(calls().at(-1)).toEqual([
      "consent",
      "update",
      { ad_storage: "denied", analytics_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" },
    ])
  })
  it("honors GPC and expired preferences", async () => {
    localStorage.setItem(consentKey, JSON.stringify({ consent: "granted", expiresAt: Date.now() - 1 }))
    const tag = await setup()
    expect(script()).toBeNull()
    Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value: true })
    tag.setConsent("granted")
    expect(tag.getSnapshot()).toMatchObject({ consent: "denied", gpc: true, ready: false })
    expect(script()).toBeNull()
  })
  it.each([
    "/admin",
    "/auth/callback",
    "/checkout/success?session_id=cs_live_private",
    "/checkout/meta?products=private",
    "/checkout/success?recovery_unavailable=1",
  ])("never loads in a sensitive document: %s", async (path) => {
    history.replaceState(null, "", path)
    const tag = await setup()
    tag.setConsent("granted")
    expect(script()).toBeNull()
    history.replaceState(null, "", "/shop")
    tag.pageView("/shop")
    expect(script()).toBeNull()
  })
  it.each([
    "/admin/concepts",
    "/auth/callback",
    "/checkout/success?session_id=cs_live_private",
    "/checkout/meta?products=private",
    "/checkout/success?recovery_unavailable=1",
  ])("remembers a sensitive starting document before configuration arrives: %s", async (path) => {
    localStorage.setItem(consentKey, JSON.stringify({ consent: "granted", expiresAt: Date.now() + 60000 }))
    history.replaceState(null, "", path)
    await import("./google-tag")
    history.replaceState(null, "", "/shop")
    const tag = await setup()
    tag.pageView("/shop")
    expect(tag.getSnapshot()).toMatchObject({ configured: true, consent: "granted", ready: false })
    expect(script()).toBeNull()
    expect(target.gtag).toBeUndefined()
  })
  it("responds to cross-tab withdrawal", async () => {
    const tag = await setup()
    tag.setConsent("granted")
    script()!.dispatchEvent(new Event("load"))
    localStorage.removeItem(consentKey)
    window.dispatchEvent(new StorageEvent("storage", { key: consentKey, newValue: null }))
    expect(tag.getSnapshot().ready).toBe(false)
  })
  it.each(["gtag", "dataLayer"] as const)("leaves an unmanaged %s untouched without loading the SDK", async (key) => {
    const externalTag = vi.fn()
    const externalLayer: IArguments[] = []
    if (key === "gtag") target.gtag = externalTag
    else target.dataLayer = externalLayer
    const tag = await setup()
    tag.setConsent("granted")
    tag.pageView("/privacy")
    await tag.trackPurchase(purchase)
    expect(script()).toBeNull()
    expect(tag.getSnapshot().ready).toBe(false)
    expect(target.gtag).toBe(key === "gtag" ? externalTag : undefined)
    expect(target.dataLayer).toBe(key === "dataLayer" ? externalLayer : undefined)
    expect(externalTag).not.toHaveBeenCalled()
    expect(externalLayer).toEqual([])
  })
  it("counts a return visit after navigation without consent, without replaying declined pages", async () => {
    history.replaceState(null, "", "/shop")
    const tag = await setup()
    tag.setConsent("granted")
    script()!.dispatchEvent(new Event("load"))
    tag.pageView("/shop")
    tag.pageView("/shop")
    tag.setConsent("denied")
    history.replaceState(null, "", "/about")
    tag.pageView("/about")
    history.replaceState(null, "", "/shop")
    tag.pageView("/shop")
    expect(calls().filter((call) => call[1] === "page_view")).toHaveLength(1)
    tag.setConsent("granted")
    tag.pageView("/shop")
    tag.pageView("/shop")
    const views = calls().filter((call) => call[1] === "page_view")
    expect(views).toHaveLength(2)
    for (const view of views) expect(view[2]).toMatchObject({ page_location: `${location.origin}/shop` })
  })
  it("keeps only a valid Merchant Center result ID in explicit page fields", async () => {
    history.replaceState(null, "", "/shop?srsltid=valid_result&email=private%40example.com#private")
    const tag = await setup()
    tag.setConsent("granted")
    script()!.dispatchEvent(new Event("load"))
    tag.pageView("/shop")
    const fields = calls().find((call) => call[1] === "page_view")?.[2]
    expect(fields).toMatchObject({ page_location: `${location.origin}/shop?srsltid=valid_result`, page_referrer: "" })
    expect(JSON.stringify(fields)).not.toContain("private")
  })
})
