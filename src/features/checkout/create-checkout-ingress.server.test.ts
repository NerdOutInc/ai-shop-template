import { runInNewContext } from "node:vm"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { marketingPreferences } from "@/features/analytics/marketing-preferences"
import { storeConfig } from "@/lib/store-config"

import { checkoutRecoveryCookie } from "./checkout-recovery-cookie.server"
import { createCheckoutIngress } from "./create-checkout-ingress.server"

vi.mock("server-only", () => ({}))

const sessionId = "cs_live_original1234567890"
const url = `https://example.com/checkout/success?session_id=${sessionId}`
const initialBrand = {
  name: storeConfig.name,
  locale: storeConfig.locale,
  theme: { ...storeConfig.theme },
  fonts: { ...storeConfig.fonts },
}

afterEach(() => {
  storeConfig.name = initialBrand.name
  storeConfig.locale = initialBrand.locale
  Object.assign(storeConfig.theme, initialBrand.theme)
  Object.assign(storeConfig.fonts, initialBrand.fonts)
})

describe("checkout ingress", () => {
  it("uses the configured brand, locale, fonts, and palette without remote assets", async () => {
    storeConfig.name = "Another & Co."
    storeConfig.locale = "en-US"
    Object.assign(storeConfig.fonts, { body: "Verdana, sans-serif", heading: "Georgia, serif", label: "monospace" })
    Object.assign(storeConfig.theme, {
      background: "#112233",
      foreground: "#ddeeff",
      secondary: "#223344",
      border: "#556677",
      primary: "#ffbb88",
      primaryForeground: "#220011",
      accent: "#99eeaa",
      accentForeground: "#112211",
    })
    const response = createCheckoutIngress(new NextRequest(url))
    const document = new DOMParser().parseFromString(await response.text(), "text/html")
    expect(document.documentElement.lang).toBe("en-US")
    expect(document.title).toBe("Returning to Another & Co.")
    expect(document.querySelector(".brand")!.textContent).toBe("Another & Co.")
    const style = document.querySelector("style")!.textContent!
    for (const key of [
      "background",
      "foreground",
      "secondary",
      "border",
      "primary",
      "primaryForeground",
      "accent",
      "accentForeground",
    ] as const)
      expect(style).toContain(storeConfig.theme[key])
    for (const font of Object.values(storeConfig.fonts)) expect(style).toContain(`font-family: ${font};`)
    expect(style).not.toMatch(/#fffdf6|#17262d|#f36a50|Arial/)
    expect(document.querySelector("script[src], img, iframe, link")).toBeNull()
  })

  it("escapes configured text instead of treating it as handoff HTML", async () => {
    storeConfig.name = 'A & <script>alert("brand")</script>'
    Object.assign(storeConfig, { locale: 'en" data-injected="true' })
    const response = createCheckoutIngress(new NextRequest(url))
    const document = new DOMParser().parseFromString(await response.text(), "text/html")
    expect(document.documentElement.lang).toBe(storeConfig.locale)
    expect(document.documentElement.getAttribute("data-injected")).toBeNull()
    expect(document.querySelector(".brand")!.textContent).toBe(storeConfig.name)
    expect(document.title).toBe(`Returning to ${storeConfig.name}`)
    expect(document.querySelectorAll("script")).toHaveLength(1)
  })

  it("isolates the sensitive document and verifies a private cookie before replacing the URL", async () => {
    const response = createCheckoutIngress(new NextRequest(url))
    const html = await response.text()
    const cookie = response.cookies.getAll().find((item) => item.name.startsWith(checkoutRecoveryCookie.prefix))!
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 2592000 })
    expect(checkoutRecoveryCookie.decode(cookie.value)).toMatchObject({ kind: "success", sessionId })
    expect(response.headers.get("referrer-policy")).toBe("no-referrer")
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'")
    expect(response.headers.get("content-security-policy")).toContain("connect-src 'self'")
    expect(html).toContain("verify:true")
    expect(html).toContain("storeCheckoutRecovery:{kind,selector,visit}")
    expect(html).toContain('"/checkout/success"')
    expect(html).toContain("recovery_unavailable=1")
    expect(html).not.toContain("facebook.net")
    const handoffDocument = new DOMParser().parseFromString(html, "text/html")
    expect(handoffDocument.querySelectorAll("script")).toHaveLength(1)
    expect(handoffDocument.querySelector("script[src], img, iframe, link")).toBeNull()
    const nonce = handoffDocument.querySelector("script")!.getAttribute("nonce")
    expect(handoffDocument.querySelector("style")!.getAttribute("nonce")).toBe(nonce)
    expect(response.headers.get("content-security-policy")).toContain(`style-src 'nonce-${nonce}'`)
    expect(response.headers.get("content-security-policy")).not.toContain("unsafe-inline")
    expect(handoffDocument.querySelector("h1")!.textContent).toBe("Reopening your checkout.")
    expect(handoffDocument.querySelector("a")!.getAttribute("href")).toBe(
      `/checkout/success?session_id=${sessionId}&recovery_unavailable=1`
    )
    // Random CSP nonces can contain these letters; inspect the executable content.
    expect(handoffDocument.querySelector("script")!.textContent).not.toContain("fbq")
  })

  it("keeps Meta selection recovery cookies limited to one day", () => {
    const response = createCheckoutIngress(new NextRequest("https://example.com/checkout/meta?products=bad"))
    expect(response.cookies.getAll()[0]).toMatchObject({ maxAge: 86400 })
  })

  it("gives simultaneous returns distinct selectors without mutating an existing cookie", () => {
    const first = createCheckoutIngress(new NextRequest(url)).cookies.getAll()[0]!
    const second = createCheckoutIngress(
      new NextRequest(url, { headers: { cookie: `${first.name}=${first.value}` } })
    ).cookies.getAll()
    expect(second).toHaveLength(1)
    expect(second[0]!.name).not.toBe(first.name)
  })

  it("evicts the oldest entries under the count budget and leaves recent orders intact", () => {
    const now = Date.now()
    const cookies = Array.from({ length: 8 }, (_, index) => ({
      name: `${checkoutRecoveryCookie.prefix}${String(index).padStart(32, "0")}`,
      value: checkoutRecoveryCookie.encode({ kind: "success", sessionId, createdAt: now - (index + 1) * 1000 }),
    }))
    const response = createCheckoutIngress(
      new NextRequest(url, { headers: { cookie: cookies.map((item) => `${item.name}=${item.value}`).join("; ") } })
    )
    const changed = response.cookies.getAll()
    expect(changed).toHaveLength(2)
    expect(changed.find((item) => item.name === cookies[7]!.name)).toMatchObject({ value: "", expires: new Date(0) })
    expect(changed.some((item) => item.name === cookies[0]!.name)).toBe(false)
  })

  it("preserves the coarse channel and known Meta platform without campaign or selection details", async () => {
    const response = createCheckoutIngress(
      new NextRequest(
        "https://example.com/checkout/meta?products=bad&cart_origin=instagram&utm_campaign=private-campaign"
      )
    )
    const html = await response.text()
    const script = html.match(/<script[^>]*>([\s\S]*)<\/script>/)![1]!
    expect(script).toContain('source:"social"')
    expect(script).toContain('metaSource:"instagram"')
    expect(script).not.toContain("private-campaign")
    expect(script).not.toContain("products=bad")
  })

  it("does not preserve an unrecognized cart origin", async () => {
    const response = createCheckoutIngress(
      new NextRequest("https://example.com/checkout/meta?products=bad&cart_origin=private-source")
    )
    const script = (await response.text()).match(/<script[^>]*>([\s\S]*)<\/script>/)![1]!
    expect(script).not.toContain("private-source")
  })
})

describe("checkout handoff script", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  async function runHandoff(
    options: {
      url?: string
      gpc?: boolean
      denied?: "meta" | "google"
      preferenceExpiresIn?: number
      savedVisit?: unknown
      fetch?: () => Promise<{ ok: boolean }>
      withoutAbortController?: boolean
      historyThrows?: boolean
      reloadThrows?: boolean
    } = {}
  ) {
    const handoffUrl = options.url ?? url
    const response = createCheckoutIngress(new NextRequest(handoffUrl))
    const html = await response.text()
    const script = new DOMParser().parseFromString(html, "text/html").querySelector("script")!.textContent!
    const fetch = vi.fn(options.fetch ?? (() => Promise.resolve({ ok: true })))
    const location = {
      href: handoffUrl,
      replace: vi.fn(),
      reload: vi.fn(() => {
        if (options.reloadThrows) throw new Error("Reload blocked")
      }),
    }
    const history = {
      state: null,
      replaceState: vi.fn((_state: unknown, _title: string, path: string) => {
        if (options.historyThrows) throw new Error("History unavailable")
        location.href = new URL(path, location.href).href
      }),
    }
    runInNewContext(script, {
      fetch,
      location,
      history,
      URL,
      Date,
      setTimeout,
      clearTimeout,
      AbortSignal: {},
      AbortController: options.withoutAbortController ? undefined : AbortController,
      navigator: { globalPrivacyControl: options.gpc },
      localStorage: {
        getItem: (key: string) =>
          options.denied && key === marketingPreferences.keys[options.denied]
            ? JSON.stringify({ consent: "denied", expiresAt: Date.now() + (options.preferenceExpiresIn ?? 1000) })
            : null,
      },
      sessionStorage: {
        getItem: () => (options.savedVisit ? JSON.stringify(options.savedVisit) : null),
        setItem: () => {},
        removeItem: () => {},
      },
    })
    await vi.advanceTimersByTimeAsync(0)
    return { fetch, location, history }
  }

  it("completes without AbortSignal.timeout and cancels the fallback deadline", async () => {
    const { fetch, location, history } = await runHandoff()
    expect(fetch).toHaveBeenCalledOnce()
    expect(history.replaceState).toHaveBeenCalledWith(
      { storeCheckoutRecovery: { kind: "success", selector: expect.any(String), visit: expect.any(Object) } },
      "",
      "/checkout/success"
    )
    expect(location.reload).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(10000)
    expect(location.replace).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("carries only the recognized Meta platform alongside the coarse source", async () => {
    const { history } = await runHandoff({
      url: "https://example.com/checkout/meta?products=private&cart_origin=instagram&utm_campaign=private-campaign",
    })
    expect(history.replaceState.mock.calls[0]?.[0]).toMatchObject({
      storeCheckoutRecovery: { visit: { source: "social", metaSource: "instagram", createdAt: expect.any(Number) } },
    })
    expect(JSON.stringify(history.replaceState.mock.calls)).not.toContain("private")
  })

  it.each(["utm_medium=paid_social", "gclid=private-click"])(
    "retains the paid channel and declared handoff platform for %s without raw campaign data",
    async (campaign) => {
      const { history } = await runHandoff({
        url: `https://example.com/checkout/meta?products=private&cart_origin=instagram&${campaign}`,
      })
      expect(history.replaceState.mock.calls[0]?.[0]).toMatchObject({
        storeCheckoutRecovery: { visit: { source: "paid", metaSource: "instagram", createdAt: expect.any(Number) } },
      })
      expect(JSON.stringify(history.replaceState.mock.calls)).not.toContain("private")
    }
  )

  it.each([{ gpc: true }, { denied: "meta" as const }, { denied: "google" as const }])(
    "does not retain the additional platform after a privacy opt-out: %j",
    async (privacy) => {
      const { history } = await runHandoff({
        ...privacy,
        url: "https://example.com/checkout/meta?products=private&cart_origin=instagram",
      })
      expect(history.replaceState.mock.calls[0]?.[0]).toMatchObject({
        storeCheckoutRecovery: { visit: { source: "social", createdAt: expect.any(Number) } },
      })
      expect(JSON.stringify(history.replaceState.mock.calls)).not.toContain("metaSource")
    }
  )

  it.each(Object.keys(marketingPreferences.keys) as ("meta" | "google")[])(
    "uses the shared %s preference key and exact lifetime boundary in the isolated script",
    async (denied) => {
      for (const [preferenceExpiresIn, blocked] of [
        [0, false],
        [1, true],
        [marketingPreferences.lifetimeMs, true],
        [marketingPreferences.lifetimeMs + 1, false],
      ] as const) {
        const { history } = await runHandoff({
          url: "https://example.com/checkout/meta?products=private&cart_origin=instagram",
          denied,
          preferenceExpiresIn,
        })
        expect(JSON.stringify(history.replaceState.mock.calls).includes("metaSource")).toBe(!blocked)
      }
    }
  )

  it("preserves a prior visit ahead of the Meta handoff", async () => {
    const { history } = await runHandoff({
      url: "https://example.com/checkout/meta?products=private&cart_origin=instagram",
      savedVisit: { source: "organic_search", createdAt: Date.now() - 1000 },
    })
    expect(history.replaceState.mock.calls[0]?.[0]).toMatchObject({
      storeCheckoutRecovery: { visit: { source: "organic_search", createdAt: expect.any(Number) } },
    })
    expect(JSON.stringify(history.replaceState.mock.calls)).not.toContain("metaSource")
  })

  it.each([
    {
      failure: "synchronous fetch throw",
      fetch: () => {
        throw new Error("Fetch unavailable")
      },
    },
    { failure: "rejected fetch", fetch: () => Promise.reject(new Error("Offline")) },
    { failure: "unsuccessful verification", fetch: () => Promise.resolve({ ok: false }) },
  ])("retains the original capability and falls back on $failure", async ({ fetch }) => {
    const { location, history } = await runHandoff({ fetch })
    expect(location.replace).toHaveBeenCalledExactlyOnceWith(
      `/checkout/success?session_id=${sessionId}&recovery_unavailable=1`
    )
    expect(history.replaceState).not.toHaveBeenCalled()
    expect(location.reload).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([false, true])("bounds a hung fetch when AbortController is missing: %s", async (withoutAbortController) => {
    let resolve!: (value: { ok: boolean }) => void
    const { location, history } = await runHandoff({
      withoutAbortController,
      fetch: () =>
        new Promise((done) => {
          resolve = done
        }),
    })
    await vi.advanceTimersByTimeAsync(9999)
    expect(location.replace).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(location.replace).toHaveBeenCalledExactlyOnceWith(
      `/checkout/success?session_id=${sessionId}&recovery_unavailable=1`
    )
    resolve({ ok: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(history.replaceState).not.toHaveBeenCalled()
    expect(location.reload).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    { failure: "history replacement", historyThrows: true },
    { failure: "reload after history replacement", reloadThrows: true },
  ])("preserves the original return when $failure throws", async (options) => {
    const { location } = await runHandoff(options)
    expect(location.replace).toHaveBeenCalledExactlyOnceWith(
      `/checkout/success?session_id=${sessionId}&recovery_unavailable=1`
    )
    expect(vi.getTimerCount()).toBe(0)
  })
})
