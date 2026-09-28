import type Stripe from "stripe"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { CheckoutError } from "@/features/checkout/checkout-error"
import type { StoredOrder } from "@/features/checkout/checkout-order"
import { getCommerceServices } from "@/features/checkout/get-commerce-services.server"

import { GET } from "./route"

vi.mock("server-only", () => ({}))
vi.mock("@/features/checkout/get-commerce-services.server", () => ({ getCommerceServices: vi.fn() }))

const sessionId = "cs_live_status1234567890"
const findBySession = vi.fn()
const retrieveSession = vi.fn()
const capacity = { admitStatus: vi.fn(), reserveStripeRead: vi.fn() }

function fixture() {
  const stored: StoredOrder = {
    sessionId,
    checkoutUrl: "https://checkout.stripe.com/c/pay/private-checkout",
    state: "pending",
    printifyOrderId: "private-provider-order",
    failureCode: null,
    payment: null,
    order: {
      requestId: "f7763d49-646d-4003-a317-9b3eb741cf78",
      commerceIdentity: "fixture-store-commerce",
      requestFingerprint: "private-fingerprint",
      expiresAt: 1_800_000_000,
      shopId: "shop1234",
      items: [
        {
          productId: "abcdef0123456789abcdef01",
          variantId: 12345,
          quantity: 1,
          unitAmount: 3000,
          title: "Private title",
          variantLabel: "Private variant",
          productFingerprint: "private-product-fingerprint",
        },
      ],
      shippingMode: "flat_rate",
      shippingEstimate: { handlingBusinessDays: 10, calendar: "us-federal-v1", timeZone: "UTC" },
      shippingAddress: {
        firstName: "Robin",
        lastName: "Sample",
        email: "robin@example.com",
        phone: "+16125550101",
        country: "US",
        region: "MN",
        city: "Minneapolis",
        address1: "123 Test Street",
        address2: "",
        zip: "55401",
      },
      shippingAmount: 495,
      subtotal: 3000,
      currency: "usd",
    },
  }
  const session = {
    id: sessionId,
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
    customer_details: { name: "Robin Sample", email: "robin@example.com", phone: "+16125550101" },
    payment_intent: "pi_private1234567890",
  } as unknown as Stripe.Checkout.Session
  return { stored, session }
}

function request(id = sessionId) {
  return new Request(`https://example.com/api/checkout/status?session_id=${encodeURIComponent(id)}`)
}

function configure(expectedLivemode = true) {
  vi.mocked(getCommerceServices).mockReturnValue({
    expectedLivemode,
    capacity,
    store: { findBySession },
    stripe: { checkout: { sessions: { retrieve: retrieveSession } } },
  } as unknown as ReturnType<typeof getCommerceServices>)
}

describe("checkout status route", () => {
  beforeEach(() => {
    const { stored, session } = fixture()
    findBySession.mockReset().mockResolvedValue(stored)
    retrieveSession.mockReset().mockResolvedValue(session)
    vi.mocked(getCommerceServices).mockReset()
    capacity.admitStatus.mockReset().mockResolvedValue(undefined)
    capacity.reserveStripeRead.mockReset().mockResolvedValue(undefined)
    configure()
  })

  it("rejects client bursts before database or Stripe reads", async () => {
    capacity.admitStatus.mockRejectedValueOnce(new CheckoutError("CHECKOUT_RATE_LIMITED", "Try later", 429))
    const response = await GET(request())
    expect(response.status).toBe(429)
    expect(response.headers.get("Retry-After")).toBe("60")
    expect(findBySession).not.toHaveBeenCalled()
    expect(retrieveSession).not.toHaveBeenCalled()
  })

  it("keeps a known unresolved order polling when the shared Stripe allowance is exhausted", async () => {
    capacity.reserveStripeRead.mockRejectedValueOnce(new CheckoutError("CHECKOUT_RATE_LIMITED", "Try later", 429))
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ paymentStatus: "pending", purchase: null })
    expect(retrieveSession).not.toHaveBeenCalled()
  })

  it("adds only the real builder's minimal purchase summary to a paid live order's status", async () => {
    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer")
    expect(await response.json()).toEqual({
      paymentStatus: "paid",
      fulfillmentStatus: "pending",
      purchase: { receipt: expect.stringMatching(/^[a-f0-9]{64}$/), totalUsd: 37.75 },
      googlePurchase: {
        transaction_id: expect.stringMatching(/^[a-f0-9]{64}$/),
        currency: "USD",
        value: 30,
        shipping: 4.95,
        tax: 2.8,
        items: [{ item_id: "abcdef0123456789abcdef01-12345", price: 30, quantity: 1 }],
      },
      metaPurchase: {
        receipt: expect.stringMatching(/^[a-f0-9]{64}$/),
        totalUsd: 37.75,
        items: [{ productId: "abcdef0123456789abcdef01", variantId: 12345, quantity: 1, unitAmount: 3000 }],
      },
    })
    expect(findBySession).toHaveBeenCalledExactlyOnceWith(sessionId)
    expect(retrieveSession).toHaveBeenCalledExactlyOnceWith(sessionId)
    expect(capacity.reserveStripeRead).toHaveBeenCalledExactlyOnceWith(sessionId, "status")
  })

  it.each(["test", "unpaid"] as const)("keeps %s checkout status available without a purchase", async (kind) => {
    const { stored, session } = fixture()
    stored.state = "pending"
    if (kind === "test") {
      session.livemode = false
      configure(false)
    } else {
      session.payment_status = "unpaid"
      session.status = "open"
    }
    findBySession.mockResolvedValue(stored)
    retrieveSession.mockResolvedValue(session)

    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer")
    expect(await response.json()).toEqual({
      paymentStatus: kind === "test" ? "paid" : "pending",
      fulfillmentStatus: "pending",
      purchase: null,
      googlePurchase: null,
      metaPurchase: null,
    })
  })

  it("keeps a fulfillment problem visible while reporting the confirmed live payment", async () => {
    const { stored } = fixture()
    stored.state = "pending"
    stored.failureCode = "PRODUCT_CHANGED"
    findBySession.mockResolvedValue(stored)

    const response = await GET(request())

    expect(await response.json()).toEqual({
      paymentStatus: "paid",
      fulfillmentStatus: "action_required",
      purchase: { receipt: expect.stringMatching(/^[a-f0-9]{64}$/), totalUsd: 37.75 },
      googlePurchase: {
        transaction_id: expect.stringMatching(/^[a-f0-9]{64}$/),
        currency: "USD",
        value: 30,
        shipping: 4.95,
        tax: 2.8,
        items: [{ item_id: "abcdef0123456789abcdef01-12345", price: 30, quantity: 1 }],
      },
      metaPurchase: {
        receipt: expect.stringMatching(/^[a-f0-9]{64}$/),
        totalUsd: 37.75,
        items: [{ productId: "abcdef0123456789abcdef01", variantId: 12345, quantity: 1, unitAmount: 3000 }],
      },
    })
  })

  it("keeps a recorded reversal visible without issuing another purchase summary", async () => {
    const { stored } = fixture()
    stored.state = "pending"
    stored.failureCode = "PAYMENT_REVERSED"
    findBySession.mockResolvedValue(stored)

    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      paymentStatus: "paid",
      fulfillmentStatus: "action_required",
      purchase: null,
      googlePurchase: null,
      metaPurchase: null,
    })
  })

  it("serves a burst of verified paid confirmations without Stripe or shared read capacity", async () => {
    const { stored } = fixture()
    stored.payment = {
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
    findBySession.mockResolvedValue(stored)
    capacity.reserveStripeRead.mockRejectedValue(new CheckoutError("CHECKOUT_RATE_LIMITED", "Try later", 429))
    retrieveSession.mockRejectedValue(new Error("Stripe unavailable"))
    for (let customer = 0; customer < 12; customer++) {
      const response = await GET(request())
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body).toMatchObject({
        paymentStatus: "paid",
        fulfillmentStatus: "pending",
        purchase: { totalUsd: 37.75 },
        googlePurchase: { tax: 2.8, value: 30 },
        metaPurchase: { totalUsd: 37.75 },
      })
      expect(JSON.stringify(body)).not.toContain("private@example.com")
      expect(JSON.stringify(body)).not.toContain("pi_verified")
    }
    expect(retrieveSession).not.toHaveBeenCalled()
    expect(capacity.reserveStripeRead).not.toHaveBeenCalled()
  })

  it.each([
    ["PAYMENT_FAILED", "failed"],
    ["CHECKOUT_EXPIRED", "expired"],
  ])("serves saved %s without spending provider capacity", async (failureCode, paymentStatus) => {
    const { stored } = fixture()
    stored.failureCode = failureCode!
    findBySession.mockResolvedValue(stored)
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      paymentStatus,
      fulfillmentStatus: "pending",
      purchase: null,
      googlePurchase: null,
      metaPurchase: null,
    })
    expect(retrieveSession).not.toHaveBeenCalled()
    expect(capacity.reserveStripeRead).not.toHaveBeenCalled()
  })

  it("rejects an invalid checkout reference before reading services", async () => {
    const response = await GET(request("invalid"))

    expect(response.status).toBe(400)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(await response.json()).toEqual({ error: "This checkout link is invalid.", code: "INVALID_REQUEST" })
    expect(getCommerceServices).not.toHaveBeenCalled()
  })

  it("returns the existing missing-order response without retrieving a Stripe session", async () => {
    findBySession.mockResolvedValue(null)

    const response = await GET(request())

    expect(response.status).toBe(404)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(await response.json()).toEqual({ error: "We could not locate this checkout.", code: "ORDER_MISSING" })
    expect(retrieveSession).not.toHaveBeenCalled()
    expect(capacity.reserveStripeRead).not.toHaveBeenCalled()
  })

  it("preserves the configuration failure response without attempting order lookup", async () => {
    vi.mocked(getCommerceServices).mockImplementation(() => {
      throw new CheckoutError("NOT_CONFIGURED", "Checkout is unavailable while we finish connecting the shop.")
    })

    const response = await GET(request())

    expect(response.status).toBe(503)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(await response.json()).toEqual({
      error: "Checkout is unavailable while we finish connecting the shop.",
      code: "NOT_CONFIGURED",
    })
    expect(findBySession).not.toHaveBeenCalled()
  })

  it("returns a safe failure when Stripe lookup fails instead of exposing provider details", async () => {
    retrieveSession.mockRejectedValue(new Error(`Provider error for ${sessionId}: robin@example.com`))

    const response = await GET(request())

    expect(response.status).toBe(503)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(await response.json()).toEqual({
      error: "The shop hit a snag. Please try again shortly.",
      code: "CHECKOUT_UNAVAILABLE",
    })
  })
})
