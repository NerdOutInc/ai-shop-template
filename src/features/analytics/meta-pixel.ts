import { isPrivateAppPath } from "@/lib/is-private-app-path"

import { buildMetaStandardEvent } from "./build-meta-standard-event"
import type { MetaStandardEvent, MetaStandardEventInput } from "./meta-standard-event"
import { marketingPreferences } from "./marketing-preferences"
import { parseMarketingPreference, type MarketingPreference } from "./parse-marketing-preference"

type Consent = "unknown" | "granted" | "denied"
type Configuration = { pixelId: string; enabled: boolean; canonicalOrigin: string }
type PixelFunction = {
  (...args: unknown[]): void
  callMethod?: (...args: unknown[]) => void
  push?: PixelFunction
  loaded?: boolean
  version?: string
  disablePushState?: boolean
  queue: unknown[][]
}
type PixelWindow = Window & { fbq?: PixelFunction; _fbq?: PixelFunction }
export type MetaPixelSnapshot = { consent: Consent; ready: boolean; configured: boolean; gpc: boolean }

const preferenceKey = marketingPreferences.keys.meta
const attemptKey = "your-store-meta-purchase-attempts-v1"
const preferenceLifetime = marketingPreferences.lifetimeMs
const attemptLifetime = 90 * 24 * 60 * 60 * 1000
const serverSnapshot: MetaPixelSnapshot = { consent: "unknown", ready: false, configured: false, gpc: false }
const listeners = new Set<() => void>()
const attempted = new Map<string, number>()
let snapshot = serverSnapshot
let configuration: Configuration | undefined
let preference: MarketingPreference | null = null
let memoryOnly = false
let expiryTimer: ReturnType<typeof setTimeout> | undefined
let blockedDocument =
  typeof window !== "undefined" && (isSensitiveUrl(window.location.href) || isSensitiveUrl(document.referrer))
let scriptState: "idle" | "loading" | "loaded" | "failed" = "idle"
let pixel: PixelFunction | undefined
let initialized = false
let grantedToSdk = false
let generation = 0
let lastPage: string | undefined
let observedPath: string | undefined
let pending: MetaStandardEvent[] = []

function isSensitiveUrl(value: string) {
  if (!value) return false
  try {
    const url = new URL(value)
    return (
      isPrivateAppPath(url.pathname) ||
      [...url.searchParams.keys()].some((key) =>
        ["session_id", "products", "coupon", "recovery_unavailable"].includes(key.toLowerCase())
      )
    )
  } catch {
    return true
  }
}

function safeDocument() {
  // Private routes and capabilities remain unsafe after later SPA navigation; the SDK can retain document history.
  if (isSensitiveUrl(window.location.href) || isSensitiveUrl(document.referrer)) blockedDocument = true
  return !blockedDocument && window.location.origin === configuration?.canonicalOrigin
}

function clearMarketingCookies() {
  try {
    const hostname = window.location.hostname
    const labels = hostname.split(".")
    const domains = ["", ...labels.slice(0, -1).map((_, index) => labels.slice(index).join("."))]
    for (const name of ["_fbp", "_fbc"])
      for (const domain of domains)
        document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax${domain ? `; Domain=${domain}` : ""}`
  } catch {
    // Cookie access can be disabled independently of preference storage.
  }
}

function revoke() {
  pending = []
  generation += 1
  if (grantedToSdk && pixel?.callMethod) {
    try {
      // Revocation is a control command, including when the new URL itself forbids events.
      pixel("consent", "revoke")
    } catch {
      // A failed third-party command cannot prevent local withdrawal.
    }
  }
  grantedToSdk = false
  clearMarketingCookies()
}

function publish(next: MetaPixelSnapshot) {
  if (
    snapshot.consent === next.consent &&
    snapshot.ready === next.ready &&
    snapshot.configured === next.configured &&
    snapshot.gpc === next.gpc
  )
    return
  snapshot = next
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // One subscriber cannot interrupt consent enforcement for the other consumers.
    }
  }
}

function refresh() {
  if (typeof window === "undefined" || !configuration) return
  if (!memoryOnly) {
    try {
      preference = parseMarketingPreference(localStorage.getItem(preferenceKey))
    } catch {
      memoryOnly = true
    }
  }
  if (preference && preference.expiresAt <= Date.now()) preference = null
  clearTimeout(expiryTimer)
  expiryTimer = preference ? setTimeout(refresh, Math.min(preference.expiresAt - Date.now(), 2_147_483_647)) : undefined
  const gpc = "globalPrivacyControl" in navigator && navigator.globalPrivacyControl === true
  const consent = gpc ? "denied" : (preference?.consent ?? "unknown")
  const configured =
    configuration.enabled &&
    /^[0-9]{5,25}$/.test(configuration.pixelId) &&
    window.location.origin === configuration.canonicalOrigin
  const safe = safeDocument()
  const permitted = configured && consent === "granted" && safe
  if (!permitted && (grantedToSdk || pending.length > 0)) revoke()
  else if (consent === "denied" && snapshot.consent !== "denied") clearMarketingCookies()
  if (permitted && scriptState === "loaded" && !grantedToSdk && pixel?.callMethod) {
    try {
      pixel("consent", "revoke")
      if (!initialized) {
        pixel("set", "autoConfig", false, configuration.pixelId)
        pixel("init", configuration.pixelId)
        initialized = true
      }
      pixel("consent", "grant")
      grantedToSdk = true
    } catch {
      scriptState = "failed"
      revoke()
    }
  }
  publish({ consent, configured, gpc, ready: permitted && grantedToSdk && scriptState === "loaded" })
  if (permitted && scriptState === "idle") loadScript()
}

function send(event: MetaStandardEvent) {
  refresh()
  if (!snapshot.ready || !pixel?.callMethod || !configuration || !safeDocument()) return false
  try {
    pixel("trackSingle", configuration.pixelId, event.name, event.parameters)
    return true
  } catch {
    return false
  }
}

function loadScript() {
  const target = window as PixelWindow
  // An unmanaged SDK may already have unsafe configuration. Do not take ownership of it.
  if (target.fbq || target._fbq) {
    scriptState = "failed"
    return
  }
  const stub: PixelFunction = (...args) => {
    if (stub.callMethod) stub.callMethod(...args)
    else stub.queue.push(args)
  }
  stub.push = stub
  stub.loaded = true
  stub.version = "2.0"
  stub.queue = []
  // The provider owns route views; autoConfig does not disable the SDK history listener.
  stub.disablePushState = true
  target.fbq = target._fbq = pixel = stub
  stub("consent", "revoke")
  scriptState = "loading"
  try {
    const script = document.createElement("script")
    script.async = true
    script.src = "https://connect.facebook.net/en_US/fbevents.js"
    script.referrerPolicy = "no-referrer"
    script.onload = () => {
      scriptState = pixel?.callMethod ? "loaded" : "failed"
      refresh()
      const queued = pending
      pending = []
      for (const event of queued) {
        if (!snapshot.ready) break
        send(event)
      }
    }
    script.onerror = () => {
      scriptState = "failed"
      pending = []
      refresh()
    }
    document.head.appendChild(script)
  } catch {
    scriptState = "failed"
    pending = []
  }
}

function readAttempts(now: number) {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(attemptKey) ?? "[]")
    if (Array.isArray(stored))
      return stored
        .filter(
          (item): item is { receipt: string; at: number } =>
            item !== null &&
            typeof item === "object" &&
            "receipt" in item &&
            typeof item.receipt === "string" &&
            /^[a-f0-9]{64}$/.test(item.receipt) &&
            "at" in item &&
            typeof item.at === "number" &&
            Number.isSafeInteger(item.at) &&
            item.at <= now &&
            now - item.at < attemptLifetime
        )
        .slice(-100)
  } catch {
    // The document's bounded memory still suppresses polling duplicates.
  }
  return []
}

export const metaPixel = {
  configure(next: Configuration) {
    if (typeof window === "undefined") return
    try {
      if (configuration) {
        if (
          configuration.pixelId !== next.pixelId ||
          configuration.canonicalOrigin !== next.canonicalOrigin ||
          configuration.enabled !== next.enabled
        ) {
          blockedDocument = true
          revoke()
        }
        refresh()
        return
      }
      configuration = { ...next }
      safeDocument()
      window.addEventListener("storage", (event) => {
        if (event.key !== preferenceKey && event.key !== null) return
        preference = event.key === null ? null : parseMarketingPreference(event.newValue)
        // A storage event also withdraws a memory-only choice when another tab clears it.
        const wasMemoryOnly = memoryOnly
        memoryOnly = true
        refresh()
        memoryOnly = wasMemoryOnly
      })
      window.addEventListener("focus", refresh)
      document.addEventListener("visibilitychange", refresh)
      // The SDK also measures cached-page restores. Recheck consent before its listener runs.
      window.addEventListener(
        "pageshow",
        (event) => {
          if (!event.persisted) return
          refresh()
          // The SDK queues revoked restore views and replays them on grant. Prevent their creation.
          if (scriptState === "loaded" && !snapshot.ready) event.stopImmediatePropagation()
        },
        true
      )
      refresh()
    } catch {
      blockedDocument = true
      revoke()
    }
  },
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  getSnapshot() {
    return snapshot
  },
  getServerSnapshot() {
    return serverSnapshot
  },
  setConsent(consent: "granted" | "denied") {
    if (typeof window === "undefined" || !configuration) return
    try {
      preference = { consent, expiresAt: Date.now() + preferenceLifetime }
      try {
        localStorage.setItem(preferenceKey, JSON.stringify(preference))
        memoryOnly = false
      } catch {
        memoryOnly = true
      }
      refresh()
    } catch {
      revoke()
    }
  },
  pageView(pathname: string) {
    if (typeof window === "undefined" || !configuration) return
    try {
      if (observedPath !== pathname) {
        observedPath = pathname
        lastPage = undefined
      }
      refresh()
      if (!snapshot.ready || !pixel?.callMethod || !safeDocument() || pathname !== window.location.pathname) return
      if (lastPage === pathname) return
      pixel("trackSingle", configuration.pixelId, "PageView")
      lastPage = pathname
    } catch {
      // Page measurement must never interfere with navigation.
    }
  },
  track(input: MetaStandardEventInput) {
    if (typeof window === "undefined") return false
    try {
      // Purchase must pass through the independent attempt guard below.
      if (input.name === "Purchase") return false
      const event = buildMetaStandardEvent(input)
      if (!event) return false
      refresh()
      if (snapshot.ready) return send(event)
      if (
        snapshot.configured &&
        snapshot.consent === "granted" &&
        scriptState === "loading" &&
        safeDocument() &&
        (event.name === "AddToCart" || event.name === "InitiateCheckout") &&
        pending.length < 20
      )
        pending.push(event)
    } catch {
      // Cart actions still succeed if validation or the third-party SDK throws.
    }
    return false
  },
  async trackPurchase(purchase: unknown): Promise<void> {
    if (typeof window === "undefined") return
    try {
      const event = buildMetaStandardEvent({ name: "Purchase", purchase })
      if (!event || !purchase || typeof purchase !== "object" || !("receipt" in purchase)) return
      const receipt = String(purchase.receipt)
      refresh()
      if (!snapshot.ready) return
      const startedGeneration = generation
      const attempt = () => {
        refresh()
        if (!snapshot.ready || startedGeneration !== generation) return
        const now = Date.now()
        for (const [id, at] of attempted) if (now - at >= attemptLifetime || at > now) attempted.delete(id)
        if (attempted.has(receipt)) return
        const receipts = readAttempts(now)
        if (receipts.some((item) => item.receipt === receipt)) return
        if (!send(event)) return
        attempted.set(receipt, now)
        if (attempted.size > 100) attempted.delete(attempted.keys().next().value!)
        try {
          // This records an SDK attempt, not confirmation that Meta ingested the event.
          localStorage.setItem(attemptKey, JSON.stringify([...receipts.slice(-99), { receipt, at: now }]))
        } catch {
          // Blocked or cleared storage can allow duplicates after reload or on another device.
        }
      }
      if (navigator.locks) await navigator.locks.request(attemptKey, attempt)
      else attempt()
    } catch {
      // Analytics cannot delay order recovery or surface an error to the customer.
    }
  },
}
