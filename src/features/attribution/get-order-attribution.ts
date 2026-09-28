import { checkoutRecoveryHistoryKey } from "@/features/checkout/checkout-recovery-history-key"
import { isMarketingDenied } from "@/features/analytics/is-marketing-denied"

import { buildOrderAttribution } from "./build-order-attribution"
import { orderAttributionSchema, type OrderAttribution } from "./order-attribution-schema"

const storageKey = "your-store-order-attribution-v1"
const lifetime = 24 * 60 * 60 * 1000
let current: OrderAttribution | undefined

function allowed(now: number) {
  if ("globalPrivacyControl" in navigator && navigator.globalPrivacyControl === true) return false
  return !isMarketingDenied(now)
}

function read(saved: unknown, now: number) {
  const parsed = orderAttributionSchema.safeParse(saved)
  if (!parsed.success) return undefined
  const createdAt = Date.parse(parsed.data.capturedAt)
  return createdAt <= now && now - createdAt < lifetime ? parsed.data : undefined
}

export function getOrderAttribution(): OrderAttribution | undefined {
  if (typeof window === "undefined") return undefined
  try {
    const now = Date.now()
    if (!allowed(now)) {
      current = undefined
      try {
        sessionStorage.removeItem(storageKey)
      } catch {
        // Revocation still clears the in-memory copy when storage is unavailable.
      }
      return undefined
    }
    const remembered = read(current, now)
    if (remembered) return remembered
    current = undefined
    try {
      current = read(JSON.parse(sessionStorage.getItem(storageKey) ?? "null"), now)
      if (!current) sessionStorage.removeItem(storageKey)
    } catch {
      // Shopping and first-touch capture still work when storage is unavailable.
    }
    if (current) return current

    const url = new URL(window.location.href)
    if (url.pathname === "/checkout/meta" && !url.search) {
      const visit = window.history.state?.[checkoutRecoveryHistoryKey]?.visit
      if (
        visit &&
        ["facebook", "instagram", "meta_shops"].includes(visit.metaSource) &&
        ["social", "paid"].includes(visit.source) &&
        typeof visit.createdAt === "number" &&
        Number.isSafeInteger(visit.createdAt) &&
        visit.createdAt <= now &&
        now - visit.createdAt < lifetime
      ) {
        url.searchParams.set("cart_origin", visit.metaSource)
        current = buildOrderAttribution(url, "", visit.createdAt)
        // The handoff retains its coarse channel, while method identifies the declared checkout platform.
        if (current && visit.source === "paid") current.channel = "paid"
      }
    } else current = buildOrderAttribution(url, document.referrer, now)

    if (current) {
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(current))
      } catch {
        // The current document keeps its attribution without persistent storage.
      }
    }
    return current
  } catch {
    // Attribution must never prevent a customer from checking out.
    return undefined
  }
}
