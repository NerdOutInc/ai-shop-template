import { describe, expect, it } from "vitest"

import type { CartItem, CartState } from "./cart-item"
import { importCartItems } from "./import-cart-items"
import { readCartState } from "./read-cart-state"
import { updateCart } from "./update-cart"

const item: CartItem = {
  productId: "aaaaaaaaaaaaaaaaaaaaaaaa",
  variantId: 1,
  title: "Sample first design",
  variantTitle: "Black / M",
  quantity: 2,
  unitAmount: 2800,
}
const key = "a".repeat(32)
const empty: CartState = { version: 1, entries: [], checkouts: {} }

describe("importCartItems", () => {
  it("does not let an unrelated entry with a malformed import prefix suppress the selection", () => {
    const unrelated = { ...item, entryId: `${key}:unrelated` }
    const state: CartState = { ...empty, entries: [unrelated] }
    const result = importCartItems(state, [item], key)
    expect(result.status).toBe("added")
    expect(result.state.entries).toHaveLength(2)
    expect(result.state.entries[0]).toEqual(unrelated)
  })

  it("adds the whole selection while preserving unrelated items and pending checkout snapshots", () => {
    const existing = { ...item, productId: "bbbbbbbbbbbbbbbbbbbbbbbb", entryId: "existing" }
    const state: CartState = {
      ...empty,
      entries: [existing],
      checkouts: { cs_test_pending: { createdAt: Date.now(), entries: [{ entryId: "existing", quantity: 2 }] } },
    }
    const result = importCartItems(state, [item, { ...item, variantId: 2 }], key)
    expect(result.status).toBe("added")
    expect(result.state.entries).toHaveLength(3)
    expect(result.state.entries[0]).toEqual(existing)
    expect(result.state.checkouts).toBe(state.checkouts)
    expect(state.entries).toEqual([existing])
  })

  it("does not add the same link twice after reload, but permits a new purchase once the first was consumed", () => {
    const first = importCartItems(empty, [item], key)
    const reloaded = readCartState(JSON.stringify(first.state))
    expect(importCartItems(reloaded, [item], key)).toEqual({ status: "already-added", state: reloaded })
    let purchased = updateCart(reloaded, { type: "remember", sessionId: "cs_test_paid", createdAt: Date.now() })
    purchased = updateCart(purchased, { type: "consume", sessionId: "cs_test_paid" })
    expect(purchased.entries).toEqual([])
    expect(importCartItems(purchased, [item], key).status).toBe("added")
  })

  it("rejects the whole import if a later line exceeds a per-variant or total limit", () => {
    const state = { ...empty, entries: [{ ...item, quantity: 9, entryId: "existing" }] }
    expect(importCartItems(state, [{ ...item, variantId: 2 }, item], key)).toEqual({ status: "limit", state })
    const full = {
      ...empty,
      entries: [
        { ...item, quantity: 10, entryId: "one" },
        { ...item, variantId: 2, quantity: 9, entryId: "two" },
      ],
    }
    expect(importCartItems(full, [{ ...item, variantId: 3 }], key)).toEqual({ status: "limit", state: full })
  })

  it.each([
    { items: [] },
    { items: [{ ...item, quantity: 11 }] },
    { items: [{ ...item, quantity: 0 }] },
    { items: [{ ...item, quantity: 1.5 }] },
    { items: [{ ...item, unitAmount: 0 }] },
    { items: [{ ...item, productId: "unknown" }] },
    { items: [{ ...item, image: "javascript:alert(1)" }] },
  ])("rejects malformed item data without changing existing state", ({ items }) => {
    expect(importCartItems(empty, items, key)).toEqual({ status: "invalid", state: empty })
  })

  it("permits deliberate reimport after all imported items are removed, preserving unrelated entries", () => {
    const oldCart = readCartState(
      JSON.stringify({ ...empty, entries: [{ ...item, variantId: 2, entryId: "original" }] })
    )
    const added = importCartItems(oldCart, [item], key).state
    const removed = updateCart(added, { type: "quantity", ...item, quantity: 0, entryId: "unused" })
    const result = importCartItems(removed, [item], key)
    expect(result.status).toBe("added")
    expect(result.state.entries).toHaveLength(2)
    expect(result.state.entries[0]).toEqual(oldCart.entries[0])
  })

  it("never consumes a reimported selection when an older checkout completes", () => {
    const first = importCartItems(empty, [item], key).state
    const pending = updateCart(first, { type: "remember", sessionId: "cs_test_old", createdAt: Date.now() })
    const removed = updateCart(pending, { type: "quantity", ...item, quantity: 0, entryId: "unused" })
    const second = importCartItems(removed, [item], key).state
    expect(second.entries[0]?.entryId).not.toBe(first.entries[0]?.entryId)
    expect(second.entries[0]?.entryId.length).toBeLessThanOrEqual(80)
    const confirmed = updateCart(second, { type: "consume", sessionId: "cs_test_old" })
    expect(confirmed.entries).toEqual(second.entries)
  })
})
