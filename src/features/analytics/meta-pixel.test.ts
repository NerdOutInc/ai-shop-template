import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const preferenceKey = "your-store-meta-consent-v1"
const attemptKey = "your-store-meta-purchase-attempts-v1"
const day = 24 * 60 * 60 * 1000
const productId = "a".repeat(24)
const purchase = {
  receipt: "b".repeat(64),
  totalUsd: 35,
  items: [{ productId, variantId: 123, quantity: 1, unitAmount: 3000 }],
}
const cartEvent = { name: "AddToCart" as const, items: purchase.items }
const viewEvent = { name: "ViewContent" as const, productId }
type TestPixel = ((...args: unknown[]) => void) & { queue: unknown[][]; callMethod?: ReturnType<typeof vi.fn> }
const target = window as Window & { fbq?: TestPixel; _fbq?: TestPixel }
const config = { enabled: true, pixelId: "123456789012345", canonicalOrigin: window.location.origin }
function spyWindowListeners() {
  return vi.spyOn(window, "addEventListener")
}
function spyDocumentListeners() {
  return vi.spyOn(document, "addEventListener")
}
let windowListeners: ReturnType<typeof spyWindowListeners>
let documentListeners: ReturnType<typeof spyDocumentListeners>

function remember(consent: "granted" | "denied", expiresAt = Date.now() + 180 * day) {
  localStorage.setItem(preferenceKey, JSON.stringify({ consent, expiresAt }))
}

async function setup(options = {}) {
  const { metaPixel } = await import("./meta-pixel")
  metaPixel.configure({ ...config, ...options })
  return metaPixel
}

function script() {
  return document.querySelector<HTMLScriptElement>('script[src="https://connect.facebook.net/en_US/fbevents.js"]')
}

function loadSdk() {
  const call = vi.fn()
  target.fbq!.callMethod = call
  for (const args of target.fbq!.queue.splice(0)) call(...args)
  script()!.dispatchEvent(new Event("load"))
  return call
}

function events(call: ReturnType<typeof vi.fn>) {
  return call.mock.calls.filter(([command]) => command === "trackSingle")
}

describe("Meta Pixel consent and delivery", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-13T12:00:00Z"))
    localStorage.clear()
    window.history.replaceState(null, "", "/shop")
    windowListeners = spyWindowListeners()
    documentListeners = spyDocumentListeners()
  })

  afterEach(() => {
    for (const [name, listener, options] of windowListeners.mock.calls)
      window.removeEventListener(name, listener, options)
    for (const [name, listener, options] of documentListeners.mock.calls)
      document.removeEventListener(name, listener, options)
    document.querySelectorAll('script[src*="connect.facebook.net"]').forEach((node) => node.remove())
    delete target.fbq
    delete target._fbq
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("loads nothing for unknown or denied consent and never replays those cart actions", async () => {
    const pixel = await setup()
    expect(pixel.getSnapshot()).toEqual({ consent: "unknown", ready: false, configured: true, gpc: false })
    pixel.track(cartEvent)
    pixel.pageView("/shop")
    await pixel.trackPurchase(purchase)
    expect(script()).toBeNull()
    pixel.setConsent("denied")
    pixel.track(cartEvent)
    expect(script()).toBeNull()
    pixel.setConsent("granted")
    expect(script()).not.toBeNull()
    const call = loadSdk()
    expect(events(call)).toEqual([])
    expect(localStorage.getItem(attemptKey)).toBeNull()
  })

  it("initializes manual tracking without identity data before granting consent and uses trackSingle", async () => {
    const pixel = await setup()
    pixel.setConsent("granted")
    expect(target.fbq!.queue).toEqual([["consent", "revoke"]])
    expect(script()!.referrerPolicy).toBe("no-referrer")
    expect(pixel.getSnapshot().ready).toBe(false)
    const call = loadSdk()
    expect(call.mock.calls).toEqual([
      ["consent", "revoke"],
      ["consent", "revoke"],
      ["set", "autoConfig", false, config.pixelId],
      ["init", config.pixelId],
      ["consent", "grant"],
    ])
    pixel.pageView("/shop")
    expect(pixel.track(viewEvent)).toBe(true)
    expect(events(call)).toEqual([
      ["trackSingle", config.pixelId, "PageView"],
      ["trackSingle", config.pixelId, "ViewContent", { content_type: "product_group", content_ids: [productId] }],
    ])
  })

  it.each([
    { enabled: false },
    { pixelId: "" },
    { pixelId: "not-a-pixel" },
    { canonicalOrigin: "https://preview.example.com" },
    { canonicalOrigin: `${config.canonicalOrigin}/` },
  ])("keeps unapproved configuration off: %j", async (options) => {
    remember("granted")
    const pixel = await setup(options)
    expect(pixel.getSnapshot().configured).toBe(false)
    expect(pixel.track(cartEvent)).toBe(false)
    expect(script()).toBeNull()
  })

  it.each([
    { options: { enabled: false }, pathname: "/shop" },
    { options: { canonicalOrigin: "https://preview.example.com" }, pathname: "/shop" },
    { options: {}, pathname: "/checkout/success?recovery_unavailable=1" },
  ])("does not repeatedly clear cookies for an unpermitted saved grant: %j", async ({ options, pathname }) => {
    window.history.replaceState(null, "", pathname)
    remember("granted")
    const writes = vi.spyOn(document, "cookie", "set")
    const pixel = await setup(options)
    for (let index = 0; index < 3; index += 1) {
      window.dispatchEvent(new Event("focus"))
      document.dispatchEvent(new Event("visibilitychange"))
    }
    expect(pixel.getSnapshot()).toMatchObject({ consent: "granted", ready: false })
    expect(script()).toBeNull()
    expect(writes).not.toHaveBeenCalled()
  })

  it("honors current saved consent without requiring another prompt and keeps snapshots stable", async () => {
    remember("granted")
    const pixel = await setup()
    const before = pixel.getSnapshot()
    expect(pixel.getSnapshot()).toBe(before)
    const listener = vi.fn()
    const unsubscribe = pixel.subscribe(listener)
    loadSdk()
    expect(listener).toHaveBeenCalledOnce()
    expect(pixel.getSnapshot()).not.toBe(before)
    expect(pixel.getServerSnapshot()).toEqual({ consent: "unknown", ready: false, configured: false, gpc: false })
    unsubscribe()
    pixel.setConsent("denied")
    expect(listener).toHaveBeenCalledOnce()
  })

  it.each([
    "bad-json",
    JSON.stringify({ consent: "granted" }),
    JSON.stringify({ consent: "granted", expiresAt: 0 }),
    JSON.stringify({ consent: "granted", expiresAt: Date.UTC(2030, 0, 1) }),
    JSON.stringify({ consent: "yes", expiresAt: Date.UTC(2026, 8, 14) }),
  ])("treats an invalid or unbounded stored preference as unknown", async (stored) => {
    localStorage.setItem(preferenceKey, stored)
    const pixel = await setup()
    expect(pixel.getSnapshot().consent).toBe("unknown")
    expect(script()).toBeNull()
  })

  it("expires consent without waiting for another action and discards delayed actions", async () => {
    remember("granted", Date.now() + 1000)
    const pixel = await setup()
    pixel.track(cartEvent)
    await vi.advanceTimersByTimeAsync(1000)
    expect(pixel.getSnapshot().consent).toBe("unknown")
    const call = loadSdk()
    expect(call.mock.calls).toEqual([["consent", "revoke"]])
    pixel.setConsent("granted")
    expect(events(call)).toEqual([])
  })

  it("also rechecks expiration before actions when timers have not run", async () => {
    remember("granted", Date.now() + 1000)
    const pixel = await setup()
    const call = loadSdk()
    vi.setSystemTime(Date.now() + 1001)
    expect(pixel.track(cartEvent)).toBe(false)
    expect(pixel.getSnapshot().consent).toBe("unknown")
    expect(events(call)).toEqual([])
    expect(call).toHaveBeenLastCalledWith("consent", "revoke")
  })

  it("schedules a full 180-day choice without overflowing the browser timer", async () => {
    const pixel = await setup()
    pixel.setConsent("granted")
    expect(JSON.parse(localStorage.getItem(preferenceKey)!)).toEqual({
      consent: "granted",
      expiresAt: Date.now() + 180 * day,
    })
    await vi.advanceTimersByTimeAsync(179 * day)
    expect(pixel.getSnapshot().consent).toBe("granted")
    await vi.advanceTimersByTimeAsync(day)
    expect(pixel.getSnapshot().consent).toBe("unknown")
  })

  it("Global Privacy Control overrides a saved or newly selected grant", async () => {
    vi.stubGlobal("navigator", { globalPrivacyControl: true })
    remember("granted")
    const pixel = await setup()
    pixel.setConsent("granted")
    expect(pixel.getSnapshot()).toMatchObject({ consent: "denied", gpc: true, ready: false })
    expect(script()).toBeNull()
  })

  it("detects GPC changes on focus and revokes the initialized SDK", async () => {
    const browser = { globalPrivacyControl: false }
    vi.stubGlobal("navigator", browser)
    remember("granted")
    const pixel = await setup()
    const call = loadSdk()
    browser.globalPrivacyControl = true
    window.dispatchEvent(new Event("focus"))
    expect(pixel.getSnapshot()).toMatchObject({ consent: "denied", gpc: true, ready: false })
    expect(call).toHaveBeenLastCalledWith("consent", "revoke")
  })

  it("applies cross-tab withdrawal and cleared preferences", async () => {
    remember("granted")
    const pixel = await setup()
    const call = loadSdk()
    remember("denied")
    window.dispatchEvent(
      new StorageEvent("storage", { key: preferenceKey, newValue: localStorage.getItem(preferenceKey) })
    )
    expect(pixel.getSnapshot().consent).toBe("denied")
    expect(pixel.track(cartEvent)).toBe(false)
    pixel.setConsent("granted")
    localStorage.clear()
    window.dispatchEvent(new StorageEvent("storage", { key: null }))
    expect(pixel.getSnapshot().consent).toBe("unknown")
    expect(pixel.track(cartEvent)).toBe(false)
    expect(events(call)).toEqual([])
  })

  it("rechecks the saved preference before delivery even before a storage event arrives", async () => {
    remember("granted")
    const pixel = await setup()
    const call = loadSdk()
    remember("denied")
    expect(pixel.track(cartEvent)).toBe(false)
    expect(events(call)).toEqual([])
  })

  it("withdraws immediately, clears its advertising cookies, and reuses initialization on regrant", async () => {
    const pixel = await setup()
    pixel.setConsent("granted")
    const call = loadSdk()
    document.cookie = "_fbp=advertising; Path=/"
    document.cookie = "_fbc=advertising; Path=/"
    pixel.setConsent("denied")
    expect(document.cookie).not.toContain("_fbp=")
    expect(document.cookie).not.toContain("_fbc=")
    expect(pixel.track(cartEvent)).toBe(false)
    pixel.setConsent("granted")
    expect(call.mock.calls.filter(([command]) => command === "init")).toHaveLength(1)
    expect(document.querySelectorAll('script[src*="connect.facebook.net"]')).toHaveLength(1)
    expect(events(call)).toEqual([])
  })

  it("queues only bounded, allowlisted cart and checkout actions after opt-in", async () => {
    const pixel = await setup()
    pixel.setConsent("granted")
    pixel.pageView("/shop")
    pixel.track(viewEvent)
    await pixel.trackPurchase(purchase)
    const item = { ...purchase.items[0]!, privateEmail: "private@example.test" }
    expect(pixel.track({ name: "InitiateCheckout", items: [item] })).toBe(false)
    item.quantity = 9
    for (let index = 0; index < 25; index += 1) pixel.track(cartEvent)
    const call = loadSdk()
    expect(events(call)).toHaveLength(20)
    expect(events(call)[0]).toEqual([
      "trackSingle",
      config.pixelId,
      "InitiateCheckout",
      {
        content_type: "product",
        content_ids: [`${productId}-123`],
        contents: [{ id: `${productId}-123`, quantity: 1, item_price: 30 }],
        currency: "USD",
        value: 30,
        num_items: 1,
      },
    ])
    expect(JSON.stringify(call.mock.calls)).not.toContain("private@example.test")
    expect(localStorage.getItem(attemptKey)).toBeNull()
  })

  it("does not initialize or replay queued actions after withdrawal during SDK loading", async () => {
    const pixel = await setup()
    pixel.setConsent("granted")
    pixel.track(cartEvent)
    pixel.setConsent("denied")
    const call = loadSdk()
    expect(call.mock.calls).toEqual([["consent", "revoke"]])
    pixel.setConsent("granted")
    expect(events(call)).toEqual([])
    expect(pixel.track(cartEvent)).toBe(true)
  })

  it("isolates a blocked or invalid SDK and leaves purchase attempts unrecorded", async () => {
    const pixel = await setup()
    pixel.setConsent("granted")
    pixel.track(cartEvent)
    script()!.dispatchEvent(new Event("error"))
    expect(pixel.getSnapshot().ready).toBe(false)
    await pixel.trackPurchase(purchase)
    expect(localStorage.getItem(attemptKey)).toBeNull()
    expect(pixel.track(cartEvent)).toBe(false)
  })

  it("does not mistake a script load without the actual SDK method for readiness", async () => {
    remember("granted")
    const pixel = await setup()
    script()!.dispatchEvent(new Event("load"))
    expect(pixel.getSnapshot().ready).toBe(false)
    expect(target.fbq!.queue).toEqual([["consent", "revoke"]])
  })

  it("deduplicates consecutive PageView updates but records later route visits", async () => {
    remember("granted")
    const pixel = await setup()
    const call = loadSdk()
    pixel.pageView("/shop")
    window.history.replaceState(null, "", "/shop?color=Blue&size=L")
    pixel.pageView("/shop")
    window.history.replaceState(null, "", "/about")
    pixel.pageView("/about")
    window.history.replaceState(null, "", "/shop")
    pixel.pageView("/shop")
    expect(events(call)).toHaveLength(3)
    pixel.pageView("/canceled-navigation")
    expect(events(call)).toHaveLength(3)
  })

  it.each(["session_id", "SeSsIoN_Id", "%73ession_id", "products", "COUPON", "recovery_unavailable"])(
    "permanently blocks a document loaded with a sensitive %s parameter",
    async (key) => {
      window.history.replaceState(null, "", `/checkout/success?${key}=private`)
      remember("granted")
      const pixel = await setup()
      window.history.replaceState(null, "", "/shop")
      pixel.configure(config)
      pixel.setConsent("granted")
      expect(pixel.track(cartEvent)).toBe(false)
      expect(script()).toBeNull()
    }
  )

  it("blocks sensitive referrers even when the current URL is clean", async () => {
    vi.spyOn(document, "referrer", "get").mockReturnValue("https://example.com/checkout/meta?products=private")
    remember("granted")
    const pixel = await setup()
    expect(pixel.getSnapshot().ready).toBe(false)
    expect(script()).toBeNull()
  })

  it.each([
    "/admin",
    "/admin/setup",
    "/admin/sign-in",
    "/admin/concepts/149",
    "/auth/callback",
    "/api/admin/assets/private-artwork",
    "/%61dmin/account",
    "/admin%2Fconcepts/149",
    "/ADMIN/agents",
    "/bad%escape",
  ])("never loads or tracks a private document at %s despite saved consent", async (pathname) => {
    window.history.replaceState(null, "", pathname)
    remember("granted")
    const pixel = await setup()
    pixel.pageView(window.location.pathname)
    expect(pixel.track(cartEvent)).toBe(false)
    await pixel.trackPurchase(purchase)
    expect(pixel.getSnapshot()).toMatchObject({ consent: "granted", ready: false })
    expect(script()).toBeNull()
    expect(localStorage.getItem(attemptKey)).toBeNull()

    window.history.replaceState(null, "", "/shop")
    pixel.configure(config)
    pixel.setConsent("granted")
    pixel.pageView("/shop")
    expect(pixel.track(viewEvent)).toBe(false)
    expect(script()).toBeNull()
  })

  it.each(["/admin/concepts/149", "/auth/callback", "/%61dmin/account", "/admin%2Fsetup", "/bad%escape"])(
    "blocks a public document with private referrer %s",
    async (pathname) => {
      vi.spyOn(document, "referrer", "get").mockReturnValue(`${config.canonicalOrigin}${pathname}`)
      remember("granted")
      const pixel = await setup()
      pixel.pageView("/shop")
      expect(pixel.track(cartEvent)).toBe(false)
      expect(pixel.getSnapshot().ready).toBe(false)
      expect(script()).toBeNull()
    }
  )

  it("retains the initial private route when navigation precedes asynchronous configuration", async () => {
    window.history.replaceState(null, "", "/admin/sign-in")
    const { metaPixel: pixel } = await import("./meta-pixel")
    window.history.replaceState(null, "", "/shop")
    remember("granted")
    pixel.configure(config)
    expect(pixel.getSnapshot().ready).toBe(false)
    expect(script()).toBeNull()
  })

  it("revokes on private SPA navigation and cannot resume tracking in the same document", async () => {
    remember("granted")
    const pixel = await setup()
    const call = loadSdk()
    pixel.pageView("/shop")
    expect(events(call)).toHaveLength(1)
    call.mockClear()

    window.history.replaceState(null, "", "/admin/concepts/149")
    pixel.pageView("/admin/concepts/149")
    expect(call).toHaveBeenLastCalledWith("consent", "revoke")
    expect(pixel.getSnapshot().ready).toBe(false)
    expect(pixel.track(cartEvent)).toBe(false)
    await pixel.trackPurchase(purchase)
    expect(events(call)).toEqual([])
    expect(localStorage.getItem(attemptKey)).toBeNull()

    call.mockClear()
    window.history.replaceState(null, "", "/shop")
    window.dispatchEvent(new Event("focus"))
    document.dispatchEvent(new Event("visibilitychange"))
    pixel.setConsent("granted")
    pixel.pageView("/shop")
    expect(pixel.track(viewEvent)).toBe(false)
    expect(call).not.toHaveBeenCalled()
  })

  it("discards queued actions if private navigation happens while the SDK is loading", async () => {
    remember("granted")
    const pixel = await setup()
    pixel.track(cartEvent)
    window.history.replaceState(null, "", "/admin/account")
    const call = loadSdk()
    expect(call.mock.calls).toEqual([["consent", "revoke"]])
    expect(pixel.getSnapshot().ready).toBe(false)
    window.history.replaceState(null, "", "/shop")
    pixel.pageView("/shop")
    expect(events(call)).toEqual([])
  })

  it.each(["/administration", "/author"])("does not treat public lookalike route %s as private", async (pathname) => {
    window.history.replaceState(null, "", pathname)
    remember("granted")
    const pixel = await setup()
    const call = loadSdk()
    pixel.pageView(pathname)
    expect(events(call)).toHaveLength(1)
  })

  it("retains the initial URL boundary if recovery cleans it before asynchronous configuration arrives", async () => {
    window.history.replaceState(null, "", "/checkout/success?session_id=private")
    const { metaPixel: pixel } = await import("./meta-pixel")
    window.history.replaceState(null, "", "/checkout/success")
    remember("granted")
    pixel.configure(config)
    expect(pixel.getSnapshot().ready).toBe(false)
    expect(script()).toBeNull()
  })

  it("checks new SPA URLs before delivery and stays blocked after returning to a clean URL", async () => {
    remember("granted")
    const pixel = await setup()
    const call = loadSdk()
    window.history.replaceState(null, "", "/checkout/meta?products=private")
    expect(pixel.track(cartEvent)).toBe(false)
    expect(call).toHaveBeenLastCalledWith("consent", "revoke")
    window.history.replaceState(null, "", "/shop")
    expect(pixel.track(cartEvent)).toBe(false)
    expect(events(call)).toEqual([])
  })

  it("revokes an active grant once when a document becomes permanently unsafe", async () => {
    remember("granted")
    const pixel = await setup()
    const call = loadSdk()
    const writes = vi.spyOn(document, "cookie", "set")
    window.history.replaceState(null, "", "/checkout/meta?products=private")
    window.dispatchEvent(new Event("focus"))
    expect(pixel.getSnapshot().ready).toBe(false)
    expect(call).toHaveBeenLastCalledWith("consent", "revoke")
    expect(writes).toHaveBeenCalled()
    call.mockClear()
    writes.mockClear()
    window.history.replaceState(null, "", "/shop")
    window.dispatchEvent(new Event("focus"))
    document.dispatchEvent(new Event("visibilitychange"))
    expect(call).not.toHaveBeenCalled()
    expect(writes).not.toHaveBeenCalled()
    expect(pixel.track(cartEvent)).toBe(false)
  })

  it("rechecks document safety before flushing delayed SDK work", async () => {
    remember("granted")
    const pixel = await setup()
    pixel.track(cartEvent)
    window.history.replaceState(null, "", "/checkout/success?session_id=private")
    const call = loadSdk()
    expect(events(call)).toEqual([])
    expect(call.mock.calls).toEqual([["consent", "revoke"]])
  })

  it("does not claim another installed SDK or reconfigure a running Pixel", async () => {
    target.fbq = Object.assign(vi.fn(), { queue: [] })
    remember("granted")
    const pixel = await setup()
    expect(script()).toBeNull()
    expect(pixel.getSnapshot().ready).toBe(false)
    expect(target.fbq).not.toHaveBeenCalled()
  })

  it("stops delivery when a later configuration disagrees", async () => {
    remember("granted")
    const pixel = await setup()
    const call = loadSdk()
    pixel.configure({ ...config, pixelId: "543210987654321" })
    pixel.configure(config)
    expect(pixel.track(cartEvent)).toBe(false)
    expect(events(call)).toEqual([])
  })

  it("records purchases once per receipt independently of Vercel attempts", async () => {
    remember("granted")
    localStorage.setItem(
      "your-store-purchase-attempts-v1",
      JSON.stringify([{ receipt: purchase.receipt, at: Date.now() }])
    )
    const pixel = await setup()
    const call = loadSdk()
    await Promise.all([pixel.trackPurchase(purchase), pixel.trackPurchase(purchase)])
    await pixel.trackPurchase(purchase)
    expect(events(call)).toHaveLength(1)
    expect(events(call)[0]).toMatchObject(["trackSingle", config.pixelId, "Purchase", { value: 35 }])
    expect(JSON.stringify(events(call))).not.toContain(purchase.receipt)
    expect(JSON.parse(localStorage.getItem(attemptKey)!)).toEqual([{ receipt: purchase.receipt, at: Date.now() }])
    expect(pixel.track({ name: "Purchase", purchase })).toBe(false)
  })

  it("uses persisted attempts on a later document and permits a different purchase", async () => {
    remember("granted")
    localStorage.setItem(attemptKey, JSON.stringify([{ receipt: purchase.receipt, at: Date.now() }]))
    const pixel = await setup()
    const call = loadSdk()
    await pixel.trackPurchase(purchase)
    await pixel.trackPurchase({ ...purchase, receipt: "c".repeat(64) })
    expect(events(call)).toHaveLength(1)
  })

  it("checks the oldest retained marker before adding a new one at capacity and expires old markers", async () => {
    remember("granted")
    const entries = Array.from({ length: 99 }, (_, index) => ({
      receipt: index.toString(16).padStart(64, "0"),
      at: Date.now(),
    }))
    localStorage.setItem(attemptKey, JSON.stringify([{ receipt: purchase.receipt, at: Date.now() }, ...entries]))
    const pixel = await setup()
    const call = loadSdk()
    await pixel.trackPurchase(purchase)
    expect(events(call)).toHaveLength(0)
    localStorage.setItem(
      attemptKey,
      JSON.stringify([{ receipt: purchase.receipt, at: Date.now() - 90 * day }, ...entries])
    )
    await pixel.trackPurchase(purchase)
    expect(events(call)).toHaveLength(1)
    expect(JSON.parse(localStorage.getItem(attemptKey)!)).toHaveLength(100)
  })

  it("uses browser locks and cancels an old pending attempt across withdrawal and regrant", async () => {
    let release: () => void = () => {}
    const request = vi.fn(
      (_name: string, callback: () => void) =>
        new Promise<void>((resolve) => {
          release = () => {
            callback()
            resolve()
          }
        })
    )
    vi.stubGlobal("navigator", { locks: { request } })
    remember("granted")
    const pixel = await setup()
    const call = loadSdk()
    const pendingPurchase = pixel.trackPurchase(purchase)
    pixel.setConsent("denied")
    pixel.setConsent("granted")
    release()
    await pendingPurchase
    expect(request).toHaveBeenCalledWith(attemptKey, expect.any(Function))
    expect(events(call)).toEqual([])
    expect(localStorage.getItem(attemptKey)).toBeNull()
  })

  it("uses memory with blocked storage while retaining consent withdrawal and purchase deduplication", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Blocked")
    })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Blocked")
    })
    const pixel = await setup()
    pixel.setConsent("granted")
    const call = loadSdk()
    await pixel.trackPurchase(purchase)
    await pixel.trackPurchase(purchase)
    expect(events(call)).toHaveLength(1)
    pixel.setConsent("denied")
    expect(pixel.track(cartEvent)).toBe(false)
    expect(pixel.getSnapshot().consent).toBe("denied")
  })

  it("isolates SDK exceptions and does not persist a failed invocation", async () => {
    remember("granted")
    const pixel = await setup()
    const call = loadSdk()
    call.mockImplementation(() => {
      throw new Error("Blocked")
    })
    expect(pixel.track(cartEvent)).toBe(false)
    expect(() => pixel.pageView("/shop")).not.toThrow()
    await expect(pixel.trackPurchase(purchase)).resolves.toBeUndefined()
    expect(localStorage.getItem(attemptKey)).toBeNull()
    expect(() => pixel.setConsent("denied")).not.toThrow()
  })

  it.each([undefined, null, {}, { ...purchase, receipt: "cs_live_private" }, { ...purchase, totalUsd: 1 }])(
    "ignores an invalid or inconsistent purchase summary",
    async (invalid) => {
      remember("granted")
      const pixel = await setup()
      const call = loadSdk()
      await pixel.trackPurchase(invalid)
      expect(events(call)).toEqual([])
      expect(localStorage.getItem(attemptKey)).toBeNull()
    }
  )
})
