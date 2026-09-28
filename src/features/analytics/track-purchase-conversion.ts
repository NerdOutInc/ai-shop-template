import type { PurchaseConversion } from "./purchase-conversion"
import { trackStoreEvent } from "./track-store-event"

const storageKey = "your-store-purchase-attempts-v1"
const lifetime = 90 * 24 * 60 * 60 * 1000
const attempted = new Set<string>()

function attemptPurchase(purchase: PurchaseConversion) {
  if (attempted.has(purchase.receipt)) return
  const now = Date.now()
  let receipts: { receipt: string; at: number }[] = []
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]")
    if (Array.isArray(stored))
      receipts = stored
        .filter(
          (item): item is { receipt: string; at: number } =>
            item !== null &&
            typeof item === "object" &&
            "receipt" in item &&
            typeof item.receipt === "string" &&
            /^[a-f0-9]{64}$/.test(item.receipt) &&
            "at" in item &&
            typeof item.at === "number" &&
            item.at <= now &&
            now - item.at < lifetime
        )
        .slice(-100)
  } catch {
    // The in-memory set still suppresses polling and remount duplicates.
  }
  if (receipts.some((item) => item.receipt === purchase.receipt)) {
    attempted.add(purchase.receipt)
    return
  }
  if (!trackStoreEvent({ name: "purchase", totalUsd: purchase.totalUsd })) return
  attempted.add(purchase.receipt)
  if (attempted.size > 100) attempted.delete(attempted.values().next().value!)
  try {
    // An attempt marker is not an ingestion receipt: the SDK has no acknowledgment.
    localStorage.setItem(storageKey, JSON.stringify([...receipts.slice(-99), { receipt: purchase.receipt, at: now }]))
  } catch {
    // Clearing or blocking storage can allow duplicates on later page loads.
  }
}

export async function trackPurchaseConversion(purchase: unknown): Promise<void> {
  if (
    !purchase ||
    typeof purchase !== "object" ||
    !("receipt" in purchase) ||
    !("totalUsd" in purchase) ||
    typeof purchase.receipt !== "string" ||
    !/^[a-f0-9]{64}$/.test(purchase.receipt) ||
    typeof purchase.totalUsd !== "number" ||
    !Number.isFinite(purchase.totalUsd) ||
    purchase.totalUsd < 0
  )
    return
  const summary = { receipt: purchase.receipt, totalUsd: purchase.totalUsd }
  try {
    // Serialize tabs on browsers that support Web Locks; storage alone is not atomic.
    if (navigator.locks) await navigator.locks.request(storageKey, () => attemptPurchase(summary))
    else attemptPurchase(summary)
  } catch {
    // Analytics must not interrupt order confirmation or retry controls.
  }
}
