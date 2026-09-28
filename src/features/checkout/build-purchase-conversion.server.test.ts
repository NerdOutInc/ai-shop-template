import { createHash } from "node:crypto"
import type Stripe from "stripe"
import { describe, expect, it, vi } from "vitest"

import { buildPurchaseConversion } from "./build-purchase-conversion.server"
import type { CheckoutPayment, StoredOrder } from "./checkout-order"

vi.mock("server-only", () => ({}))

function fixture() {
  const stored: StoredOrder = {
    sessionId: "cs_live_purchase1234567890",
    checkoutUrl: "https://checkout.stripe.com/c/pay/example",
    state: "pending",
    printifyOrderId: null,
    failureCode: null,
    payment: null,
    order: {
      requestId: "0f271d57-31dc-4f4d-a3d2-4393ac7593da",
      commerceIdentity: "fixture-store-commerce",
      requestFingerprint: "fingerprint",
      expiresAt: 1_800_000_000,
      shopId: "shop1234",
      items: [],
      shippingMode: "flat_rate",
      shippingEstimate: { handlingBusinessDays: 10, calendar: "us-federal-v1", timeZone: "UTC" },
      shippingAmount: 495,
      subtotal: 3000,
      currency: "usd",
    },
  }
  const session = {
    id: stored.sessionId!,
    object: "checkout.session",
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    livemode: true,
    currency: "usd",
    client_reference_id: stored.order.requestId,
    amount_subtotal: 3000,
    amount_total: 3775,
    total_details: { amount_tax: 280, amount_discount: 0, amount_shipping: 495 },
    metadata: {
      storefront: "fixture-store-commerce",
      shop_id: stored.order.shopId,
      checkout_request_id: stored.order.requestId,
    },
  } as unknown as Stripe.Checkout.Session
  return { session, stored }
}

function verifiedPayment(): CheckoutPayment {
  return {
    status: "paid",
    paymentIntentId: "pi_verified",
    paidAt: "2026-09-28T12:00:00.000Z",
    livemode: true,
    currency: "usd",
    subtotalAmount: 3000,
    shippingAmount: 495,
    taxAmount: 280,
    totalAmount: 3775,
    customerName: "Private Customer",
    customerEmail: "private@example.com",
  }
}

describe("buildPurchaseConversion", () => {
  it("uses the same minimal receipt from the immutable verified capture without a Session read", () => {
    const { stored, session } = fixture()
    const expected = buildPurchaseConversion(session, stored, true)
    stored.payment = verifiedPayment()
    expect(buildPurchaseConversion(null, stored, true)).toEqual(expected)
    expect(Object.keys(buildPurchaseConversion(null, stored, true)!)).toEqual(["receipt", "totalUsd"])
  })

  it.each<Partial<CheckoutPayment>>([
    { livemode: false },
    { currency: "eur" as "usd" },
    { subtotalAmount: 1 },
    { shippingAmount: 0 },
    { taxAmount: -1 },
    { taxAmount: 280.5 },
    { totalAmount: 1 },
    { totalAmount: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects inconsistent saved capture values %j", (patch) => {
    const { stored } = fixture()
    stored.payment = { ...verifiedPayment(), ...patch }
    expect(buildPurchaseConversion(null, stored, true)).toBeNull()
  })

  it.each(["test-environment", "simulated", "reversed", "identity-missing", "session-missing"])(
    "does not count a saved capture when %s",
    (kind) => {
      const { stored } = fixture()
      stored.payment = verifiedPayment()
      if (kind === "simulated") stored.state = "simulated"
      if (kind === "reversed") stored.failureCode = "PAYMENT_REVERSED"
      if (kind === "identity-missing") Reflect.deleteProperty(stored.order, "commerceIdentity")
      if (kind === "session-missing") stored.sessionId = null
      expect(buildPurchaseConversion(null, stored, kind !== "test-environment")).toBeNull()
    }
  )

  it("counts a saved payment identity independently of the current store configuration", () => {
    const { session, stored } = fixture()
    stored.order.commerceIdentity = "permanent-store"
    session.metadata!.storefront = "permanent-store"
    expect(buildPurchaseConversion(session, stored, true)?.totalUsd).toBe(37.75)
    Reflect.deleteProperty(stored.order, "commerceIdentity")
    expect(buildPurchaseConversion(session, stored, true)).toBeNull()
  })

  it("uses the confirmed total, including tax", () => {
    const { session, stored } = fixture()
    expect(buildPurchaseConversion(session, stored, true)).toEqual({
      receipt: createHash("sha256").update(session.id).digest("hex"),
      totalUsd: 37.75,
    })
  })

  it("keeps a stable private marker without exposing checkout references", () => {
    const { session, stored } = fixture()
    const result = buildPurchaseConversion(session, stored, true)
    expect(result?.receipt).toMatch(/^[a-f0-9]{64}$/)
    expect(result).toEqual(buildPurchaseConversion(session, stored, true))
    expect(JSON.stringify(result)).not.toContain(session.id)
    expect(JSON.stringify(result)).not.toContain(stored.order.requestId)
    session.id = "cs_live_different1234567890"
    stored.sessionId = session.id
    expect(buildPurchaseConversion(session, stored, true)?.receipt).not.toBe(result?.receipt)
  })

  it.each<StoredOrder["failureCode"]>([null, "PROVIDER_PROCESSING", "PRODUCT_CHANGED", "SHIPPING_ADDRESS_INVALID"])(
    "counts a live payment independently of fulfillment failure %s",
    (failureCode) => {
      const { session, stored } = fixture()
      stored.failureCode = failureCode
      expect(buildPurchaseConversion(session, stored, true)?.totalUsd).toBe(37.75)
    }
  )

  it("does not count test mode even before simulated fulfillment is recorded", () => {
    const { session, stored } = fixture()
    expect(buildPurchaseConversion(session, stored, false)).toBeNull()
    session.livemode = false
    expect(buildPurchaseConversion(session, stored, true)).toBeNull()
    expect(buildPurchaseConversion(session, stored, false)).toBeNull()
    session.livemode = true
    stored.state = "simulated"
    expect(buildPurchaseConversion(session, stored, true)).toBeNull()
  })

  it("suppresses a recorded payment reversal even when the session still reports paid", () => {
    const { session, stored } = fixture()
    expect(buildPurchaseConversion(session, stored, true)).not.toBeNull()
    stored.failureCode = "PAYMENT_REVERSED"
    expect(session.payment_status).toBe("paid")
    expect(buildPurchaseConversion(session, stored, true)).toBeNull()
  })

  it.each<[string, Partial<Stripe.Checkout.Session>]>([
    ["unpaid", { payment_status: "unpaid" }],
    ["no payment required", { payment_status: "no_payment_required" }],
    ["open", { status: "open" }],
    ["expired", { status: "expired" }],
    ["subscription", { mode: "subscription" }],
    ["session mismatch", { id: "cs_live_unrelated1234567890" }],
    ["client reference mismatch", { client_reference_id: "other-request" }],
    ["currency mismatch", { currency: "eur" }],
    ["missing metadata", { metadata: null }],
    ["missing totals", { total_details: null }],
    ["subtotal mismatch", { amount_subtotal: 3495 }],
    ["total mismatch", { amount_total: 3495 }],
    ["missing total", { amount_total: null }],
    ["fractional total", { amount_total: 3775.5 }],
    ["unsafe total", { amount_total: Number.MAX_SAFE_INTEGER + 1 }],
    ["negative total", { amount_total: -3775 }],
  ])("rejects %s", (_name, patch) => {
    const { session, stored } = fixture()
    Object.assign(session, patch)
    expect(buildPurchaseConversion(session, stored, true)).toBeNull()
  })

  it.each(["storefront", "shop_id", "checkout_request_id"])("binds metadata field %s to the stored order", (key) => {
    const { session, stored } = fixture()
    session.metadata![key] = "other"
    expect(buildPurchaseConversion(session, stored, true)).toBeNull()
  })

  it.each([
    { amount_tax: -1 },
    { amount_tax: 280.5 },
    { amount_tax: Number.MAX_SAFE_INTEGER + 1 },
    { amount_discount: 100 },
    { amount_shipping: 0 },
  ])("rejects inconsistent tax, discounts, or shipping: %j", (patch) => {
    const { session, stored } = fixture()
    Object.assign(session.total_details!, patch)
    expect(buildPurchaseConversion(session, stored, true)).toBeNull()
  })

  it.each(["subtotal", "shippingAmount"] as const)("rejects a corrupted stored %s", (key) => {
    const { session, stored } = fixture()
    stored.order[key] = -1
    expect(buildPurchaseConversion(session, stored, true)).toBeNull()
    stored.order[key] = Number.NaN
    expect(buildPurchaseConversion(session, stored, true)).toBeNull()
  })

  it("rejects a missing stored session", () => {
    const { session, stored } = fixture()
    stored.sessionId = null
    expect(buildPurchaseConversion(session, stored, true)).toBeNull()
  })
})
