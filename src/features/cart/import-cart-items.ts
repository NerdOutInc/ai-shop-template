import { cartLimits } from "@/lib/cart-limits"

import type { CartItem, CartState } from "./cart-item"
import { getCartImportKey } from "./get-cart-import-key"
import { readCartState } from "./read-cart-state"
import { updateCart } from "./update-cart"

export type CartImportStatus = "added" | "already-added" | "invalid" | "limit"

export function importCartItems(
  state: CartState,
  items: CartItem[],
  importKey: string
): { status: CartImportStatus; state: CartState } {
  if (!/^[a-f0-9]{32}$/.test(importKey) || items.length === 0 || items.length > cartLimits.maxLines)
    return { status: "invalid", state }
  if (state.entries.some((entry) => getCartImportKey(entry.entryId) === importKey))
    return { status: "already-added", state }
  const entries = items.map((item) => ({ ...item, entryId: `${importKey}:${crypto.randomUUID()}` }))
  const validated = readCartState(JSON.stringify({ version: 1, entries, checkouts: {} }))
  if (validated.entries.length !== entries.length) return { status: "invalid", state }

  let next = state
  for (const entry of validated.entries) {
    const added = updateCart(next, { type: "add", item: entry, entryId: entry.entryId })
    // Never leave half of a social shopping selection in the customer's cart.
    if (added === next) return { status: "limit", state }
    next = added
  }
  return {
    status: "added",
    state: next,
  }
}
