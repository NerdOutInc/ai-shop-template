import { cartLimits } from "@/lib/cart-limits"

import type { CartItem, CartState } from "./cart-item"

type CartAction =
  | { type: "add"; item: CartItem; entryId: string }
  | { type: "quantity"; productId: string; variantId: number; quantity: number; entryId: string }
  | { type: "remember"; sessionId: string; createdAt: number; entries?: { entryId: string; quantity: number }[] }
  | { type: "consume"; sessionId: string }

export function updateCart(state: CartState, action: CartAction): CartState {
  if (action.type === "remember") {
    return {
      ...state,
      checkouts: {
        ...state.checkouts,
        [action.sessionId]: {
          createdAt: action.createdAt,
          entries: action.entries ?? state.entries.map(({ entryId, quantity }) => ({ entryId, quantity })),
        },
      },
    }
  }
  if (action.type === "consume") {
    const snapshot = state.checkouts[action.sessionId]
    if (!snapshot) return state
    const purchased = new Map(snapshot.entries.map((entry) => [entry.entryId, entry.quantity]))
    const checkouts = { ...state.checkouts }
    delete checkouts[action.sessionId]
    return {
      ...state,
      checkouts,
      entries: state.entries.flatMap((entry) => {
        const quantity = entry.quantity - (purchased.get(entry.entryId) ?? 0)
        return quantity > 0 ? [{ ...entry, quantity }] : []
      }),
    }
  }
  if (action.type === "add") {
    const { item } = action
    const total = state.entries.reduce((sum, entry) => sum + entry.quantity, 0)
    const sameVariant = state.entries.filter(
      (entry) => entry.productId === item.productId && entry.variantId === item.variantId
    )
    if (
      !Number.isSafeInteger(item.quantity) ||
      item.quantity < 1 ||
      total + item.quantity > cartLimits.maxTotalQuantity ||
      sameVariant.reduce((sum, entry) => sum + entry.quantity, 0) + item.quantity > cartLimits.maxQuantityPerVariant
    )
      return state
    return {
      ...state,
      entries: [
        ...state.entries.map((entry) =>
          entry.productId === item.productId && entry.variantId === item.variantId
            ? { ...entry, unitAmount: item.unitAmount }
            : entry
        ),
        { ...item, entryId: action.entryId },
      ],
    }
  }
  const matches = (entry: CartItem) => entry.productId === action.productId && entry.variantId === action.variantId
  const existing = state.entries.find(matches)
  if (
    !existing ||
    !Number.isSafeInteger(action.quantity) ||
    action.quantity < 0 ||
    action.quantity > cartLimits.maxQuantityPerVariant
  )
    return state
  const current = state.entries.filter(matches).reduce((sum, entry) => sum + entry.quantity, 0)
  if (action.quantity > current)
    return updateCart(state, {
      type: "add",
      item: { ...existing, quantity: action.quantity - current },
      entryId: action.entryId,
    })
  let remaining = action.quantity
  return {
    ...state,
    entries: state.entries.flatMap((entry) => {
      if (!matches(entry)) return [entry]
      const quantity = Math.min(remaining, entry.quantity)
      remaining -= quantity
      return quantity > 0 ? [{ ...entry, quantity }] : []
    }),
  }
}
