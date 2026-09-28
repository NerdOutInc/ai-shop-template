import type Stripe from "stripe"
import { describe, expect, it, vi } from "vitest"

import { buildMetaPurchaseConversion } from "./build-meta-purchase-conversion.server"
import { buildPurchaseConversion } from "./build-purchase-conversion.server"
import type { StoredOrder } from "./checkout-order"

vi.mock("server-only", () => ({}))

function fixture() {
  const stored: StoredOrder = {
    sessionId: "cs_live_metapurchase1234567890",
    checkoutUrl: "https://checkout.stripe.com/c/pay/private",
    state: "pending",
    printifyOrderId: null,
    failureCode: null,
    payment: null,
    order: {
      requestId: "0f271d57-31dc-4f4d-a3d2-4393ac7593da",
      requestFingerprint: "private-request-fingerprint",
      expiresAt: 1_800_000_000,
      shopId: "shop1234",
      items: [
        {
          productId: "aabbccddeeff001122334455",
          variantId: 12345,
          quantity: 2,
          unitAmount: 2800,
          title: "A shirt",
          variantLabel: "Black / L",
          productFingerprint: "private-product-fingerprint",
        },
        {
          productId: "aabbccddeeff001122334455",
          variantId: 12346,
          quantity: 1,
          unitAmount: 2800,
          title: "A shirt",
          variantLabel: "Black / XL",
          productFingerprint: "private-product-fingerprint",
        },
      ],
      shippingMode: "flat_rate",
      shippingEstimate: { handlingBusinessDays: 10, calendar: "us-federal-v1", timeZone: "UTC" },
      shippingAmount: 495,
      subtotal: 8400,
      currency: "usd",
    },
  }
  const session = {
    id: stored.sessionId!,
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    livemode: true,
    currency: "usd",
    client_reference_id: stored.order.requestId,
    amount_subtotal: 8400,
    amount_total: 9491,
    total_details: { amount_tax: 596, amount_discount: 0, amount_shipping: 495 },
    metadata: {
      storefront: "your-store",
      shop_id: stored.order.shopId,
      checkout_request_id: stored.order.requestId,
    },
  } as unknown as Stripe.Checkout.Session
  return { stored, session }
}

describe("buildMetaPurchaseConversion", () => {
  it("projects exact stored variants and the verified total including shipping and tax", () => {
    const { session, stored } = fixture()
    const purchase = buildPurchaseConversion(session, stored, true)
    const result = buildMetaPurchaseConversion(purchase, stored)
    expect(result?.receipt).toBe(purchase?.receipt)
    expect(result).toEqual({
      receipt: expect.stringMatching(/^[a-f0-9]{64}$/),
      totalUsd: 94.91,
      items: [
        { productId: "aabbccddeeff001122334455", variantId: 12345, quantity: 2, unitAmount: 2800 },
        { productId: "aabbccddeeff001122334455", variantId: 12346, quantity: 1, unitAmount: 2800 },
      ],
    })
    for (const privateValue of [session.id, stored.order.requestId, "private", "Black", "A shirt", "shop1234"])
      expect(JSON.stringify(result)).not.toContain(privateValue)
    expect(result?.items[0]).not.toBe(stored.order.items[0])
  })

  it("reuses payment eligibility independently of fulfillment state", () => {
    const { session, stored } = fixture()
    stored.failureCode = "SHIPPING_ADDRESS_INVALID"
    expect(buildMetaPurchaseConversion(buildPurchaseConversion(session, stored, true), stored)).not.toBeNull()
    expect(buildMetaPurchaseConversion(buildPurchaseConversion(session, stored, false), stored)).toBeNull()
    session.livemode = false
    expect(buildMetaPurchaseConversion(buildPurchaseConversion(session, stored, true), stored)).toBeNull()
    session.livemode = true
    stored.state = "simulated"
    expect(buildMetaPurchaseConversion(buildPurchaseConversion(session, stored, true), stored)).toBeNull()
  })

  it("does not enrich an ineligible purchase", () => {
    const { stored } = fixture()
    expect(buildMetaPurchaseConversion(null, stored)).toBeNull()
  })

  it("does not enrich a payment whose reversal has been recorded", () => {
    const { session, stored } = fixture()
    expect(buildMetaPurchaseConversion(buildPurchaseConversion(session, stored, true), stored)).not.toBeNull()
    stored.failureCode = "PAYMENT_REVERSED"
    const purchase = buildPurchaseConversion(session, stored, true)
    expect(purchase).toBeNull()
    expect(buildMetaPurchaseConversion(purchase, stored)).toBeNull()
  })

  it.each<Partial<Stripe.Checkout.Session>>([
    { status: "open" },
    { payment_status: "unpaid" },
    { id: "cs_live_unrelated1234567890" },
    { currency: "eur" },
    { amount_total: 8400 },
    { metadata: null },
  ])("rejects a session that fails existing paid-order verification: %j", (patch) => {
    const { session, stored } = fixture()
    Object.assign(session, patch)
    expect(buildMetaPurchaseConversion(buildPurchaseConversion(session, stored, true), stored)).toBeNull()
  })

  it("rejects line totals that do not explain the stored merchandise subtotal", () => {
    const { session, stored } = fixture()
    stored.order.items[0]!.unitAmount = 2700
    expect(buildMetaPurchaseConversion(buildPurchaseConversion(session, stored, true), stored)).toBeNull()
  })

  it.each([
    { productId: "not-a-catalog-id" },
    { variantId: Number.MAX_SAFE_INTEGER + 1 },
    { quantity: 0 },
    { quantity: 0.5 },
    { unitAmount: Number.NaN },
  ])("rejects malformed stored catalog lines: %j", (patch) => {
    const { session, stored } = fixture()
    Object.assign(stored.order.items[0]!, patch)
    expect(buildMetaPurchaseConversion(buildPurchaseConversion(session, stored, true), stored)).toBeNull()
  })

  it("rejects an order without catalog lines", () => {
    const { session, stored } = fixture()
    stored.order.items = []
    expect(buildMetaPurchaseConversion(buildPurchaseConversion(session, stored, true), stored)).toBeNull()
  })
})
