import { storeConfig } from "@/lib/store-config"
import { isPrivateAppPath } from "@/lib/is-private-app-path"

import { buildGooglePurchaseEvent } from "./build-google-purchase-event"
import { marketingPreferences } from "./marketing-preferences"
import { parseMarketingPreference, type MarketingPreference } from "./parse-marketing-preference"

type Consent = "unknown" | "granted" | "denied"
type Configuration = { enabled: boolean; tagId: string; canonicalOrigin: string }
type Tag = (...args: unknown[]) => void
type TagWindow = Window & { gtag?: Tag; dataLayer?: IArguments[] }
export type GoogleTagSnapshot = { configured: boolean; ready: boolean; consent: Consent; gpc: boolean }

const preferenceKey = marketingPreferences.keys.google
const attemptKey = "your-store-google-purchase-attempts-v1"
const lifetime = marketingPreferences.lifetimeMs
const attemptLifetime = 90 * 24 * 60 * 60 * 1000
const denied = {
  ad_storage: "denied",
  analytics_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
}
const granted = { ...denied, ad_storage: "granted", analytics_storage: "granted", ad_user_data: "granted" }
const initial: GoogleTagSnapshot = { configured: false, ready: false, consent: "unknown", gpc: false }
const listeners = new Set<() => void>()
const attempted = new Map<string, number>()
let snapshot = initial
let configuration: Configuration | undefined
let preference: MarketingPreference | null = null
let memoryOnly = false
let timer: ReturnType<typeof setTimeout> | undefined
let tag: Tag | undefined
let scriptState: "idle" | "loading" | "loaded" | "failed" = "idle"
let initialized = false
let permittedToSdk = false
let blocked = typeof window !== "undefined" && (sensitive(window.location.href) || sensitive(document.referrer))
let generation = 0
let lastPage: string | undefined
let observedPath: string | undefined

function sensitive(raw: string) {
  if (!raw) return false
  try {
    const url = new URL(raw)
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
  // SDKs may retain document history after navigation, so an unsafe document stays blocked.
  if (sensitive(location.href) || sensitive(document.referrer)) blocked = true
  return !blocked && location.origin === configuration?.canonicalOrigin
}

function clearCookies() {
  try {
    const labels = location.hostname.split(".")
    const domains = ["", ...labels.slice(0, -1).map((_, i) => labels.slice(i).join("."))]
    const names = document.cookie
      .split(";")
      .map((cookie) => cookie.trim().split("=")[0]!)
      .filter((name) => /^(?:_ga(?:_|$)|_gid$|_gat(?:_|$)|_gcl_|_gac_)/.test(name))
    for (const name of names)
      for (const domain of domains)
        document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax${domain ? `; Domain=${domain}` : ""}`
  } catch {
    /* Cookie cleanup must not block the visitor's choice. */
  }
}

function revoke() {
  generation += 1
  if (permittedToSdk) {
    try {
      tag?.("consent", "update", denied)
    } catch {
      /* Local withdrawal still applies. */
    }
  }
  permittedToSdk = false
  clearCookies()
}

function publish(next: GoogleTagSnapshot) {
  if (
    Object.keys(next).every((key) => next[key as keyof GoogleTagSnapshot] === snapshot[key as keyof GoogleTagSnapshot])
  )
    return
  snapshot = next
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      /* Other subscribers still receive consent changes. */
    }
  }
}

function pageFields() {
  const url = new URL(location.pathname, location.origin)
  // Keep only Merchant Center attribution, after consent; arbitrary query values never enter event fields.
  const click = new URL(location.href).searchParams.get("srsltid")
  if (click && /^[A-Za-z0-9_-]{1,512}$/.test(click)) url.searchParams.set("srsltid", click)
  return { page_location: url.href, page_referrer: "", page_title: storeConfig.name }
}

function load() {
  const target = window as TagWindow
  if (target.gtag || target.dataLayer) {
    scriptState = "failed"
    return
  }
  target.dataLayer = []
  // gtag.js consumes Arguments objects, as in Google's documented bootstrap.
  target.gtag = tag = function () {
    // Google interprets plain arrays as method calls, not gtag commands; its bootstrap requires Arguments.
    // eslint-disable-next-line prefer-rest-params
    target.dataLayer!.push(arguments)
  }
  tag("consent", "default", denied)
  tag("set", "ads_data_redaction", true)
  tag("set", "url_passthrough", false)
  scriptState = "loading"
  const script = document.createElement("script")
  script.async = true
  script.referrerPolicy = "no-referrer"
  script.src = `https://www.googletagmanager.com/gtag/js?id=${configuration!.tagId}`
  script.onload = () => {
    scriptState = "loaded"
    refresh()
  }
  script.onerror = () => {
    scriptState = "failed"
    refresh()
  }
  document.head.appendChild(script)
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
  clearTimeout(timer)
  timer = preference ? setTimeout(refresh, Math.min(preference.expiresAt - Date.now(), 2_147_483_647)) : undefined
  const gpc = "globalPrivacyControl" in navigator && navigator.globalPrivacyControl === true
  const consent = gpc ? "denied" : (preference?.consent ?? "unknown")
  const configured =
    configuration.enabled &&
    /^GT-[A-Z0-9]{4,20}$/.test(configuration.tagId) &&
    location.origin === configuration.canonicalOrigin
  const permitted = configured && consent === "granted" && safeDocument()
  if (!permitted && permittedToSdk) revoke()
  else if (consent !== "granted" && snapshot.consent === "granted") revoke()
  if (permitted && scriptState === "loaded" && !permittedToSdk) {
    tag?.("consent", "update", granted)
    if (!initialized) {
      tag?.("js", new Date())
      tag?.("config", configuration.tagId, {
        send_page_view: false,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
        ...pageFields(),
      })
      initialized = true
    }
    permittedToSdk = true
  }
  publish({ configured, consent, gpc, ready: permitted && permittedToSdk && scriptState === "loaded" })
  if (permitted && scriptState === "idle") load()
}

function readAttempts(now: number) {
  try {
    const rows: unknown = JSON.parse(localStorage.getItem(attemptKey) ?? "[]")
    if (Array.isArray(rows))
      return rows
        .filter(
          (row): row is { id: string; at: number } =>
            row !== null &&
            typeof row === "object" &&
            "id" in row &&
            "at" in row &&
            typeof row.at === "number" &&
            typeof row.id === "string" &&
            /^[a-f0-9]{64}$/.test(row.id) &&
            Number.isSafeInteger(row.at) &&
            row.at <= now &&
            now - row.at < attemptLifetime
        )
        .slice(-100)
  } catch {
    /* Memory also limits repeats when storage is unavailable. */
  }
  return []
}

export const googleTag = {
  configure(next: Configuration) {
    if (typeof window === "undefined") return
    try {
      if (configuration) {
        if (
          configuration.tagId !== next.tagId ||
          configuration.enabled !== next.enabled ||
          configuration.canonicalOrigin !== next.canonicalOrigin
        ) {
          blocked = true
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
        const previous = memoryOnly
        memoryOnly = true
        refresh()
        memoryOnly = previous
      })
      window.addEventListener("focus", refresh)
      document.addEventListener("visibilitychange", refresh)
      refresh()
    } catch {
      blocked = true
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
    return initial
  },
  setConsent(consent: "granted" | "denied") {
    if (typeof window === "undefined" || !configuration) return
    preference = { consent, expiresAt: Date.now() + lifetime }
    try {
      localStorage.setItem(preferenceKey, JSON.stringify(preference))
      memoryOnly = false
    } catch {
      memoryOnly = true
    }
    try {
      refresh()
    } catch {
      revoke()
    }
  },
  pageView(pathname: string) {
    if (typeof window === "undefined") return
    try {
      if (observedPath !== pathname) {
        observedPath = pathname
        lastPage = undefined
      }
      refresh()
      if (!snapshot.ready || !safeDocument() || pathname !== location.pathname || pathname === lastPage) return
      tag?.("event", "page_view", { send_to: configuration!.tagId, ...pageFields() })
      lastPage = pathname
    } catch {
      /* Measurement must not interrupt navigation. */
    }
  },
  async trackPurchase(input: unknown) {
    if (typeof window === "undefined") return
    try {
      const event = buildGooglePurchaseEvent(input)
      refresh()
      if (!event || !snapshot.ready) return
      const startedGeneration = generation
      const attempt = () => {
        refresh()
        if (!snapshot.ready || !safeDocument() || startedGeneration !== generation) return
        const now = Date.now()
        for (const [id, at] of attempted) if (at > now || now - at >= attemptLifetime) attempted.delete(id)
        const rows = readAttempts(now)
        if (attempted.has(event.transaction_id) || rows.some((row) => row.id === event.transaction_id)) return
        tag?.("event", "purchase", { ...event, send_to: configuration!.tagId, ...pageFields() })
        attempted.set(event.transaction_id, now)
        if (attempted.size > 100) attempted.delete(attempted.keys().next().value!)
        try {
          localStorage.setItem(attemptKey, JSON.stringify([...rows.slice(-99), { id: event.transaction_id, at: now }]))
        } catch {
          /* An SDK attempt is not an ingestion receipt. */
        }
      }
      if (navigator.locks) await navigator.locks.request(attemptKey, attempt)
      else attempt()
    } catch {
      /* Tracking must not interrupt paid-order recovery. */
    }
  },
}
