import { describe, expect, it } from "vitest"

import { readCartState } from "./read-cart-state"

const entry = {
  entryId: "addition",
  productId: "aaaaaaaaaaaaaaaaaaaaaaaa",
  variantId: 1,
  title: "Good hangs",
  variantTitle: "M",
  quantity: 2,
  unitAmount: 2800,
}

describe("stored cart validation", () => {
  it.each([
    null,
    "{",
    "[]",
    JSON.stringify({ version: 2, entries: [entry] }),
    JSON.stringify({ version: 1, entries: [{ ...entry, quantity: -1 }] }),
    JSON.stringify({ version: 1, entries: [{ ...entry, quantity: 11 }] }),
    JSON.stringify({ version: 1, entries: [{ ...entry, unitAmount: 100_001 }] }),
    JSON.stringify({ version: 1, entries: [{ ...entry, image: "javascript:alert(1)" }] }),
  ])("recovers safely from invalid browser state %s", (raw) => {
    expect(readCartState(raw).entries).toEqual([])
  })

  it("keeps a stored cart at the checkout quantity and unit-price boundaries", () => {
    const entries = [
      { ...entry, quantity: 10, unitAmount: 100_000 },
      { ...entry, entryId: "second", variantId: 2, quantity: 10 },
    ]
    expect(readCartState(JSON.stringify({ version: 1, entries })).entries).toEqual(entries)
  })

  it("keeps only non-PII catalog fields and valid recent checkout snapshots", () => {
    const state = readCartState(
      JSON.stringify({
        version: 1,
        entries: [{ ...entry, email: "someone@example.com" }],
        shippingAddress: { address1: "Private" },
        checkouts: {
          cs_test_recent1234567890: {
            createdAt: Date.now(),
            entries: [{ entryId: entry.entryId, quantity: 2 }],
            email: "someone@example.com",
          },
          cs_test_old1234567890: { createdAt: 0, entries: [] },
        },
      })
    )
    expect(state.entries).toEqual([entry])
    expect(Object.keys(state.checkouts)).toEqual(["cs_test_recent1234567890"])
    expect(JSON.stringify(state)).not.toContain("someone")
    expect(JSON.stringify(state)).not.toContain("Private")
  })

  it("rejects duplicate additions and aggregated quantities beyond server limits", () => {
    expect(readCartState(JSON.stringify({ version: 1, entries: [entry, entry] })).entries).toEqual([])
    expect(
      readCartState(JSON.stringify({ version: 1, entries: [entry, { ...entry, entryId: "another", quantity: 10 }] }))
        .entries
    ).toEqual([])
  })
})
