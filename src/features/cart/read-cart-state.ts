import { cartLimits } from "@/lib/cart-limits"
import { isCheckoutSessionId } from "@/features/checkout/is-checkout-session-id"

import type { CartEntry, CartState } from "./cart-item"

function isEntry(value: unknown): value is CartEntry {
  if (typeof value !== "object" || value === null) return false
  const item = value as Record<string, unknown>
  return (
    typeof item.entryId === "string" &&
    item.entryId.length <= 80 &&
    typeof item.productId === "string" &&
    /^[a-f0-9]{24}$/.test(item.productId) &&
    typeof item.variantId === "number" &&
    Number.isSafeInteger(item.variantId) &&
    item.variantId > 0 &&
    typeof item.title === "string" &&
    item.title.length > 0 &&
    item.title.length <= 200 &&
    typeof item.variantTitle === "string" &&
    item.variantTitle.length <= 200 &&
    typeof item.unitAmount === "number" &&
    Number.isSafeInteger(item.unitAmount) &&
    item.unitAmount > 0 &&
    item.unitAmount <= cartLimits.maxUnitAmount &&
    typeof item.quantity === "number" &&
    Number.isSafeInteger(item.quantity) &&
    item.quantity >= 1 &&
    item.quantity <= cartLimits.maxQuantityPerVariant &&
    (item.image === undefined ||
      (typeof item.image === "string" && item.image.length < 3000 && /^(https:\/\/|\/(?!\/))/.test(item.image)))
  )
}

export function readCartState(raw: string | null): CartState {
  const empty: CartState = { version: 1, entries: [], checkouts: {} }
  if (!raw || raw.length > 100_000) return empty
  try {
    const parsed = JSON.parse(raw) as Partial<CartState>
    if (parsed.version !== 1 || !Array.isArray(parsed.entries) || !parsed.entries.every(isEntry)) return empty
    if (parsed.entries.reduce((sum, entry) => sum + entry.quantity, 0) > cartLimits.maxTotalQuantity) return empty
    const quantities = new Map<string, number>()
    const entryIds = new Set<string>()
    for (const entry of parsed.entries) {
      const key = `${entry.productId}:${entry.variantId}`
      const quantity = (quantities.get(key) ?? 0) + entry.quantity
      if (quantity > cartLimits.maxQuantityPerVariant || entryIds.has(entry.entryId)) return empty
      quantities.set(key, quantity)
      entryIds.add(entry.entryId)
    }
    const checkouts: CartState["checkouts"] = {}
    if (parsed.checkouts && typeof parsed.checkouts === "object") {
      for (const [sessionId, snapshot] of Object.entries(parsed.checkouts).slice(-10)) {
        if (
          !isCheckoutSessionId(sessionId) ||
          !snapshot ||
          typeof snapshot.createdAt !== "number" ||
          !Number.isFinite(snapshot.createdAt) ||
          snapshot.createdAt < Date.now() - 30 * 24 * 60 * 60 * 1000 ||
          !Array.isArray(snapshot.entries)
        )
          continue
        if (
          snapshot.entries.length > cartLimits.maxLines ||
          !snapshot.entries.every(
            (entry) =>
              entry &&
              typeof entry.entryId === "string" &&
              entry.entryId.length <= 80 &&
              Number.isSafeInteger(entry.quantity) &&
              entry.quantity >= 1 &&
              entry.quantity <= cartLimits.maxQuantityPerVariant
          )
        )
          continue
        checkouts[sessionId] = {
          createdAt: snapshot.createdAt,
          entries: snapshot.entries.map(({ entryId, quantity }) => ({ entryId, quantity })),
        }
      }
    }
    return {
      version: 1,
      // Copy only catalog fields; never preserve arbitrary data from browser storage.
      entries: parsed.entries.map(
        ({ entryId, productId, variantId, title, variantTitle, image, unitAmount, quantity }) => ({
          entryId,
          productId,
          variantId,
          title,
          variantTitle,
          image,
          unitAmount,
          quantity,
        })
      ),
      checkouts,
    }
  } catch {
    return empty
  }
}
