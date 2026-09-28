import { describe, expect, it } from "vitest"

import type { CartItem, CartState } from "./cart-item"
import { updateCart } from "./update-cart"

const item: CartItem = {
  productId: "aaaaaaaaaaaaaaaaaaaaaaaa",
  variantId: 1,
  title: "Sample first design",
  variantTitle: "Coral / M",
  unitAmount: 2800,
  quantity: 2,
}
const empty: CartState = { version: 1, entries: [], checkouts: {} }

describe("cart purchase reconciliation", () => {
  it("removes only purchased additions, preserves later identical items, and is repeatable", () => {
    let state = updateCart(empty, { type: "add", item, entryId: "original" })
    state = updateCart(state, { type: "remember", sessionId: "cs_test_paid", createdAt: Date.now() })
    state = updateCart(state, { type: "add", item: { ...item, quantity: 1 }, entryId: "later" })
    state = updateCart(state, { type: "consume", sessionId: "cs_test_paid" })
    expect(state.entries).toEqual([{ ...item, quantity: 1, entryId: "later" }])
    expect(updateCart(state, { type: "consume", sessionId: "cs_test_paid" })).toBe(state)
  })

  it("does not consume a replacement added after the original was removed", () => {
    let state = updateCart(empty, { type: "add", item, entryId: "original" })
    state = updateCart(state, { type: "remember", sessionId: "cs_test_paid", createdAt: Date.now() })
    state = updateCart(state, { type: "quantity", ...item, quantity: 0, entryId: "unused" })
    state = updateCart(state, { type: "add", item, entryId: "replacement" })
    state = updateCart(state, { type: "consume", sessionId: "cs_test_paid" })
    expect(state.entries).toEqual([{ ...item, entryId: "replacement" }])
  })

  it("uses the snapshot captured before the checkout request", () => {
    let state = updateCart(empty, { type: "add", item, entryId: "purchased" })
    const entries = state.entries.map(({ entryId, quantity }) => ({ entryId, quantity }))
    state = updateCart(state, { type: "add", item, entryId: "added-during-checkout" })
    state = updateCart(state, { type: "remember", sessionId: "cs_test_paid", createdAt: Date.now(), entries })
    state = updateCart(state, { type: "consume", sessionId: "cs_test_paid" })
    expect(state.entries).toEqual([{ ...item, entryId: "added-during-checkout" }])
  })

  it("enforces the server quantity limits and updates re-added variant prices", () => {
    let state = updateCart(empty, { type: "add", item: { ...item, quantity: 10 }, entryId: "first" })
    expect(updateCart(state, { type: "add", item, entryId: "over-limit" })).toBe(state)
    state = updateCart(state, { type: "add", item: { ...item, variantId: 2, quantity: 10 }, entryId: "second" })
    expect(updateCart(state, { type: "add", item: { ...item, variantId: 3 }, entryId: "over-total" })).toBe(state)
    state = updateCart(state, { type: "quantity", ...item, quantity: 8, entryId: "unused" })
    state = updateCart(state, { type: "add", item: { ...item, unitAmount: 3200 }, entryId: "updated-price" })
    expect(state.entries.filter((entry) => entry.variantId === 1).every((entry) => entry.unitAmount === 3200)).toBe(
      true
    )
  })
})
