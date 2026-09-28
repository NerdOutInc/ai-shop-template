import { describe, expect, it } from "vitest"

import { buildGooglePurchaseEvent } from "./build-google-purchase-event"

const purchase = {
  transaction_id: "a".repeat(64),
  currency: "USD",
  value: 60,
  shipping: 7.35,
  tax: 4.2,
  items: [{ item_id: "abcdef0123456789abcdef01-12345", price: 30, quantity: 2 }],
}

describe("Google purchase fields", () => {
  it("includes merchandise, tax and shipping separately and strips unknown fields", () => {
    expect(
      buildGooglePurchaseEvent({
        ...purchase,
        email: "private@example.com",
        items: [{ ...purchase.items[0], title: "Private title" }],
      })
    ).toEqual(purchase)
  })
  it.each([
    { value: 71.55 },
    { value: 60.001 },
    { currency: "EUR" },
    { tax: -1 },
    { shipping: NaN },
    { transaction_id: "cs_live_private" },
    { items: [] },
    { items: [...purchase.items, ...purchase.items] },
    { items: [{ ...purchase.items[0], quantity: 0 }] },
    { items: [{ ...purchase.items[0], item_id: "abcdef0123456789abcdef01-9007199254740992" }] },
  ])("rejects invalid totals, identifiers or items: %j", (patch) => {
    expect(buildGooglePurchaseEvent({ ...purchase, ...patch })).toBeNull()
  })
})
