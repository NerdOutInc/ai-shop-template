import { storeConfig } from "@/lib/store-config"
import "../../../test/configured-store"
import { randomUUID } from "node:crypto"
import type Stripe from "stripe"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { CheckoutError } from "./checkout-error"
import type { CheckoutPayment, CheckoutOrder, OrderStore, StoredOrder } from "./checkout-order"
import { PrintifyClient } from "./printify-client.server"

import { fulfillCheckout } from "./fulfill-checkout.server"
import { readCheckoutProduct } from "./read-checkout-product.server"

vi.mock("server-only", () => ({}))
vi.mock("./read-checkout-product.server", () => ({ readCheckoutProduct: vi.fn() }))

beforeEach(() => {
  vi.mocked(readCheckoutProduct).mockResolvedValue({
    id: "111111000000000000000002",
    title: "Toast to Small Wins",
    variants: [
      { id: 101, unitAmount: 3000, label: "Forest / M", available: true, fingerprint: `v2:${"a".repeat(64)}` },
    ],
  })
})

describe("paid checkout fulfillment", () => {
  it("recovers a paid saved order after cosmetic rebranding and configuration drift", async () => {
    const fixture = checkoutFixture()
    fixture.session.livemode = false
    storeConfig.id = "fresh-brand"
    storeConfig.name = "Fresh Brand"
    storeConfig.commerce.identity = "accidental-config-change"
    expect(await fulfillCheckout(fixture.services, fixture.sessionId)).toBe("simulated")
    expect(fixture.getStored()?.payment?.status).toBe("paid")
    expect(fixture.ensureCommerceIdentity).not.toHaveBeenCalled()
  })

  it("fails explicitly when a saved order has no payment identity", async () => {
    const fixture = checkoutFixture()
    Reflect.deleteProperty(fixture.order, "commerceIdentity")
    await expect(fulfillCheckout(fixture.services, fixture.sessionId)).rejects.toMatchObject({
      code: "ORDER_IDENTITY_MISSING",
    })
    expect(fixture.getStored()?.failureCode).toBe("ORDER_IDENTITY_MISSING")
    expect(fixture.getStored()?.payment).toBeNull()
    expect(readCheckoutProduct).not.toHaveBeenCalled()
  })

  it("rejects foreign metadata on a known order instead of silently ignoring its paid event", async () => {
    const fixture = checkoutFixture()
    fixture.session.metadata.storefront = "another-store"
    await expect(fulfillCheckout(fixture.services, fixture.sessionId)).rejects.toMatchObject({
      code: "PAYMENT_MISMATCH",
    })
    expect(fixture.getStored()?.failureCode).toBe("PAYMENT_MISMATCH")
    expect(readCheckoutProduct).not.toHaveBeenCalled()
  })

  it("ignores a foreign session with no saved order", async () => {
    const fixture = checkoutFixture()
    fixture.setStored(null)
    fixture.session.metadata.storefront = "another-store"
    expect(await fulfillCheckout(fixture.services, fixture.sessionId)).toBe("ignored")
    expect(readCheckoutProduct).not.toHaveBeenCalled()
  })

  it("saves verified payment facts before delivery failures so a paid order remains visible", async () => {
    const fixture = checkoutFixture()
    fixture.session.collected_information.shipping_details = null
    await expect(fulfillCheckout(fixture.services, fixture.sessionId)).rejects.toMatchObject({
      code: "SHIPPING_ADDRESS_INVALID",
    })
    expect(fixture.getStored()?.payment).toEqual({
      status: "paid",
      paymentIntentId: "pi_fixture",
      paidAt: new Date(1789999200 * 1000).toISOString(),
      livemode: true,
      currency: "usd",
      subtotalAmount: 3000,
      shippingAmount: 495,
      taxAmount: 0,
      totalAmount: 3495,
      customerName: "Robin Sample",
      customerEmail: "robin@example.com",
    })
  })

  it.each([
    { code: "42703", live: true },
    { code: "23514", live: true },
    { code: "QUERY_TIMEOUT", live: true },
    { code: "42703", live: false },
    { code: "23514", live: false },
    { code: "QUERY_TIMEOUT", live: false },
  ])("holds fulfillment with a distinct capture-write failure for $code (live=$live)", async ({ code, live }) => {
    const fixture = checkoutFixture()
    fixture.session.livemode = live
    const request = vi.spyOn(fixture.printify, "request")
    fixture.savePayment.mockRejectedValueOnce(Object.assign(new Error("Private database detail"), { code }))
    await expect(fulfillCheckout(fixture.services, fixture.sessionId)).rejects.toMatchObject({
      code: "PAYMENT_CAPTURE_UNAVAILABLE",
      message: "Your paid order needs our attention before printing.",
    })
    expect(fixture.getStored()).toMatchObject({
      state: "pending",
      failureCode: "PAYMENT_CAPTURE_UNAVAILABLE",
      payment: null,
    })
    expect(fixture.getStored()?.order.shippingAddress).toBeUndefined()
    expect(request).not.toHaveBeenCalled()
    expect(readCheckoutProduct).not.toHaveBeenCalled()
    // A retry resumes the same order after storage recovers; simulation still never calls Printify.
    if (!live) {
      expect(await fulfillCheckout(fixture.services, fixture.sessionId)).toBe("simulated")
      expect(fixture.getStored()?.failureCode).toBeNull()
      expect(request).not.toHaveBeenCalled()
    }
  })

  it("preserves a capture conflict instead of reporting a storage outage", async () => {
    const fixture = checkoutFixture()
    fixture.savePayment.mockRejectedValueOnce(new CheckoutError("PAYMENT_CAPTURE_CONFLICT", "Capture conflict"))
    await expect(fulfillCheckout(fixture.services, fixture.sessionId)).rejects.toMatchObject({
      code: "PAYMENT_CAPTURE_CONFLICT",
    })
    expect(fixture.getStored()?.failureCode).toBe("PAYMENT_CAPTURE_CONFLICT")
  })

  it("stores the billing customer separately from a gift's delivery recipient", async () => {
    const fixture = checkoutFixture()
    fixture.session.livemode = false
    fixture.session.customer_details.name = "Alex Giftgiver"
    expect(await fulfillCheckout(fixture.services, fixture.sessionId)).toBe("simulated")
    expect(fixture.getStored()?.payment?.customerName).toBe("Alex Giftgiver")
    expect(fixture.getStored()?.order.shippingAddress).toMatchObject({ firstName: "Robin", lastName: "Sample" })
  })

  it("does not record a capture when the charged amount does not match the order", async () => {
    const fixture = checkoutFixture()
    fixture.session.amount_total = 1
    await expect(fulfillCheckout(fixture.services, fixture.sessionId)).rejects.toMatchObject({
      code: "PAYMENT_MISMATCH",
    })
    expect(fixture.getStored()?.payment).toBeNull()
  })

  it("rejects an invalid capture timestamp before recording payment or contacting Printify", async () => {
    const fixture = checkoutFixture()
    const intent = await fixture.stripe.paymentIntents.retrieve("pi_fixture")
    ;(intent.latest_charge as Stripe.Charge).created = Number.NaN
    vi.mocked(fixture.stripe.paymentIntents.retrieve).mockResolvedValue(intent)
    await expect(fulfillCheckout(fixture.services, fixture.sessionId)).rejects.toMatchObject({
      code: "PAYMENT_MISMATCH",
    })
    expect(fixture.getStored()?.payment).toBeNull()
  })

  it.each(["intent-id", "intent-mode", "charge-intent", "charge-mode"])(
    "does not record a capture with a mismatched %s",
    async (field) => {
      const fixture = checkoutFixture()
      const intent = await fixture.stripe.paymentIntents.retrieve("pi_fixture")
      const charge = intent.latest_charge as Stripe.Charge
      if (field === "intent-id") intent.id = "pi_other"
      if (field === "intent-mode") intent.livemode = false
      if (field === "charge-intent") charge.payment_intent = "pi_other"
      if (field === "charge-mode") charge.livemode = false
      vi.mocked(fixture.stripe.paymentIntents.retrieve).mockResolvedValue(intent)
      await expect(fulfillCheckout(fixture.services, fixture.sessionId)).rejects.toMatchObject({
        code: "PAYMENT_MISMATCH",
      })
      expect(fixture.getStored()?.payment).toBeNull()
    }
  )

  it("captures Stripe delivery details before creating the paid flat-rate order", async () => {
    const fixture = checkoutFixture()
    const request = vi
      .spyOn(fixture.printify, "request")
      .mockImplementationOnce(async () => {
        expect(fixture.getStored()?.order.shippingAddress).toMatchObject({ firstName: "Robin", zip: "55401" })
        return { id: "printify-order" }
      })
      .mockResolvedValueOnce(fixture.providerOrder)
      .mockResolvedValueOnce(null)
    expect(fixture.getStored()?.order.shippingAddress).toBeUndefined()
    expect(await fulfillCheckout(fixture.services, fixture.sessionId)).toBe("submitted")
    expect(await fulfillCheckout(fixture.services, fixture.sessionId)).toBe("submitted")
    expect(request).toHaveBeenCalledTimes(3)
    expect(request.mock.calls[0]?.[1]).toMatchObject({ address_to: fixture.providerOrder.address_to })
  })

  it("captures valid delivery details for a simulated flat-rate order without Printify calls", async () => {
    const fixture = checkoutFixture()
    fixture.session.livemode = false
    const request = vi.spyOn(fixture.printify, "request")
    expect(await fulfillCheckout(fixture.services, fixture.sessionId)).toBe("simulated")
    expect(fixture.getStored()?.payment).toMatchObject({ livemode: false, totalAmount: 3495 })
    expect(fixture.getStored()?.order.shippingAddress).toMatchObject({ firstName: "Robin", zip: "55401" })
    expect(request).not.toHaveBeenCalled()
  })

  it.each([true, false])(
    "holds missing delivery details before provider work or simulation (live=%s)",
    async (live) => {
      const fixture = checkoutFixture()
      fixture.session.livemode = live
      fixture.session.collected_information.shipping_details = null
      const request = vi.spyOn(fixture.printify, "request")
      await expect(fulfillCheckout(fixture.services, fixture.sessionId)).rejects.toMatchObject({
        code: "SHIPPING_ADDRESS_INVALID",
      })
      expect(fixture.getStored()).toMatchObject({ state: "pending", failureCode: "SHIPPING_ADDRESS_INVALID" })
      expect(fixture.getStored()?.order.shippingAddress).toBeUndefined()
      expect(request).not.toHaveBeenCalled()
    }
  )

  it("holds an unsupported delivery destination before creating a provider order", async () => {
    const fixture = checkoutFixture()
    fixture.session.collected_information.shipping_details!.address.state = "PR"
    const request = vi.spyOn(fixture.printify, "request")
    await expect(fulfillCheckout(fixture.services, fixture.sessionId)).rejects.toMatchObject({
      code: "SHIPPING_DESTINATION_UNSUPPORTED",
    })
    expect(fixture.getStored()?.order.shippingAddress).toBeUndefined()
    expect(request).not.toHaveBeenCalled()
  })

  it.each(["subtotal", "shipping", "shipping-subtotal", "shipping-total", "shipping-tax", "discount"])(
    "rejects changed flat-rate %s before saving delivery details",
    async (change) => {
      const fixture = checkoutFixture()
      if (change === "subtotal") fixture.session.amount_subtotal += 495
      if (change === "shipping") fixture.session.total_details.amount_shipping = 1
      if (change === "shipping-subtotal") fixture.session.shipping_cost.amount_subtotal = 1
      if (change === "shipping-total") fixture.session.shipping_cost.amount_total = 1
      if (change === "shipping-tax") fixture.session.shipping_cost.amount_tax = -1
      if (change === "discount") fixture.session.total_details.amount_discount = 1
      const request = vi.spyOn(fixture.printify, "request")
      await expect(fulfillCheckout(fixture.services, fixture.sessionId)).rejects.toMatchObject({
        code: "PAYMENT_MISMATCH",
      })
      expect(fixture.getStored()?.order.shippingAddress).toBeUndefined()
      expect(request).not.toHaveBeenCalled()
    }
  )

  it.each(["amount", "currency", "request", "kind", "tax-behavior", "id"])(
    "holds a shipping rate with mismatched %s",
    async (change) => {
      const fixture = checkoutFixture()
      const rate = await fixture.stripe.shippingRates.retrieve("shr_fixture")
      if (change === "amount") rate.fixed_amount!.amount = 1
      if (change === "currency") rate.fixed_amount!.currency = "cad"
      if (change === "request") rate.metadata.checkout_request_id = randomUUID()
      if (change === "kind") rate.metadata.kind = "merchandise"
      if (change === "tax-behavior") rate.tax_behavior = "inclusive"
      if (change === "id") rate.id = "shr_other"
      vi.mocked(fixture.stripe.shippingRates.retrieve).mockResolvedValue(rate)
      const request = vi.spyOn(fixture.printify, "request")
      await expect(fulfillCheckout(fixture.services, fixture.sessionId)).rejects.toMatchObject({
        code: "PAYMENT_MISMATCH",
      })
      expect(fixture.getStored()?.order.shippingAddress).toBeUndefined()
      expect(request).not.toHaveBeenCalled()
    }
  )

  it.each(["amount", "captured-amount", "currency", "refunded", "partial-refund", "disputed"])(
    "holds a flat-rate payment with a %s charge before capturing the destination",
    async (change) => {
      const fixture = checkoutFixture()
      const intent = await fixture.stripe.paymentIntents.retrieve("pi_fixture")
      const charge = intent.latest_charge as Stripe.Charge
      if (change === "amount") charge.amount = 1
      if (change === "captured-amount") charge.amount_captured = 1
      if (change === "currency") charge.currency = "cad"
      if (change === "refunded") charge.refunded = true
      if (change === "partial-refund") charge.amount_refunded = 1
      if (change === "disputed") charge.disputed = true
      vi.mocked(fixture.stripe.paymentIntents.retrieve).mockResolvedValue(intent)
      const request = vi.spyOn(fixture.printify, "request")
      await expect(fulfillCheckout(fixture.services, fixture.sessionId)).rejects.toMatchObject({
        code: "PAYMENT_REVERSED",
      })
      expect(fixture.getStored()?.order.shippingAddress).toBeUndefined()
      expect(request).not.toHaveBeenCalled()
    }
  )

  it("requires the shipping amount to remain a shipping rate rather than a merchandise line", async () => {
    const fixture = checkoutFixture()
    vi.mocked(fixture.stripe.checkout.sessions.listLineItems).mockResolvedValue({
      data: [
        fixture.line,
        {
          quantity: 1,
          currency: "usd",
          amount_subtotal: 495,
          price: {
            unit_amount: 495,
            product: { metadata: { kind: "shipping", checkout_request_id: fixture.order.requestId } },
          },
        },
      ],
      has_more: false,
    } as never)
    const request = vi.spyOn(fixture.printify, "request")
    await expect(fulfillCheckout(fixture.services, fixture.sessionId)).rejects.toMatchObject({
      code: "PAYMENT_MISMATCH",
    })
    expect(request).not.toHaveBeenCalled()
  })

  it("accepts merchandise and shipping tax while verifying the full charge", async () => {
    const fixture = checkoutFixture()
    fixture.session.livemode = false
    fixture.session.amount_total = 3775
    fixture.session.total_details.amount_tax = 280
    fixture.session.shipping_cost.amount_tax = 40
    fixture.session.shipping_cost.amount_total = 535
    vi.mocked(fixture.stripe.paymentIntents.retrieve).mockResolvedValue({
      id: "pi_fixture",
      livemode: false,
      status: "succeeded",
      currency: "usd",
      amount_received: 3775,
      latest_charge: {
        payment_intent: "pi_fixture",
        livemode: false,
        created: 1789999200,
        amount: 3775,
        amount_captured: 3775,
        currency: "usd",
        captured: true,
        paid: true,
        refunded: false,
        amount_refunded: 0,
        disputed: false,
      },
    } as never)
    expect(await fulfillCheckout(fixture.services, fixture.sessionId)).toBe("simulated")
    expect(fixture.getStored()?.payment).toMatchObject({
      subtotalAmount: 3000,
      shippingAmount: 495,
      taxAmount: 280,
      totalAmount: 3775,
    })
  })

  it("retains the saved destination while recovering an ambiguous flat-rate order create", async () => {
    const fixture = checkoutFixture()
    const request = vi.spyOn(fixture.printify, "request").mockRejectedValueOnce(new Error("socket lost"))
    await expect(fulfillCheckout(fixture.services, fixture.sessionId)).rejects.toThrow("socket lost")
    const savedAddress = fixture.getStored()?.order.shippingAddress
    expect(savedAddress).toMatchObject({ zip: "55401" })
    request
      .mockResolvedValueOnce({ current_page: 1, last_page: 1, data: [fixture.providerOrder] })
      .mockResolvedValueOnce(null)
    expect(await fulfillCheckout(fixture.services, fixture.sessionId)).toBe("submitted")
    expect(fixture.getStored()?.order.shippingAddress).toEqual(savedAddress)
    expect(request.mock.calls.filter(([path, body]) => path === "orders.json" && body)).toHaveLength(1)
  })

  it("holds a changed Stripe destination on replay without overwriting the paid destination", async () => {
    const fixture = checkoutFixture()
    const request = vi.spyOn(fixture.printify, "request").mockRejectedValueOnce(new Error("socket lost"))
    await expect(fulfillCheckout(fixture.services, fixture.sessionId)).rejects.toThrow("socket lost")
    fixture.session.collected_information.shipping_details!.address.postal_code = "90210"
    request.mockClear()
    await expect(fulfillCheckout(fixture.services, fixture.sessionId)).rejects.toMatchObject({
      code: "SHIPPING_ADDRESS_CONFLICT",
    })
    expect(fixture.getStored()?.order.shippingAddress?.zip).toBe("55401")
    expect(fixture.getStored()?.state).toBe("creating")
    expect(request).not.toHaveBeenCalled()
  })

  it("creates and submits the exact paid order once across repeated events", async () => {
    const fixture = checkoutFixture()
    const request = vi
      .spyOn(fixture.printify, "request")
      .mockResolvedValueOnce({ id: "printify-order" })
      .mockResolvedValueOnce(fixture.providerOrder)
      .mockResolvedValueOnce(null)
    expect(await fulfillCheckout(fixture.services, fixture.sessionId)).toBe("submitted")
    expect(await fulfillCheckout(fixture.services, fixture.sessionId)).toBe("submitted")
    expect(request).toHaveBeenCalledTimes(3)
    expect(request.mock.calls[0]).toEqual([
      "orders.json",
      expect.objectContaining({
        external_id: fixture.sessionId,
        shipping_method: 1,
        line_items: [expect.objectContaining({ product_id: fixture.productId, variant_id: 101, quantity: 1 })],
      }),
    ])
    expect(fixture.getStored()).toMatchObject({ state: "submitted", printifyOrderId: "printify-order" })
  })

  it("waits for delayed payment before creating any order", async () => {
    const fixture = checkoutFixture()
    fixture.session.payment_status = "unpaid"
    const request = vi.spyOn(fixture.printify, "request")
    expect(await fulfillCheckout(fixture.services, fixture.sessionId)).toBe("unpaid")
    expect(fixture.getStored()?.payment).toBeNull()
    expect(request).not.toHaveBeenCalled()
    expect(readCheckoutProduct).not.toHaveBeenCalled()
  })

  it.each(["changed", "unknown-version", "disabled"])(
    "stops %s before any provider order is created",
    async (change) => {
      const fixture = checkoutFixture()
      fixture.order.items[0]!.productFingerprint =
        change === "unknown-version" ? `v3:${"a".repeat(64)}` : `v2:${"b".repeat(64)}`
      vi.mocked(readCheckoutProduct).mockResolvedValue({
        id: fixture.productId,
        title: "Toast to Small Wins",
        variants: [
          {
            id: 101,
            unitAmount: 3000,
            label: "Forest / M",
            available: change !== "disabled",
            fingerprint: `v2:${"a".repeat(64)}`,
          },
        ],
      })
      const request = vi.spyOn(fixture.printify, "request")
      await expect(fulfillCheckout(fixture.services, fixture.sessionId)).rejects.toMatchObject({
        code: "PRODUCT_CHANGED",
      })
      expect(request).not.toHaveBeenCalled()
    }
  )

  it("records a paid test-mode checkout as simulated without any Printify calls", async () => {
    const fixture = checkoutFixture()
    fixture.session.livemode = false
    const request = vi.spyOn(fixture.printify, "request")
    expect(await fulfillCheckout(fixture.services, fixture.sessionId)).toBe("simulated")
    expect(request).not.toHaveBeenCalled()
    expect(readCheckoutProduct).not.toHaveBeenCalled()
  })

  it.each(["amount", "variant", "refunded", "artwork"])("blocks fulfillment after %s mismatch", async (change) => {
    const fixture = checkoutFixture()
    if (change === "amount") fixture.session.amount_total = 1
    if (change === "variant") fixture.line.price.product.metadata.variant_id = "999"
    if (change === "refunded")
      vi.mocked(fixture.stripe.paymentIntents.retrieve).mockResolvedValue({
        id: "pi_fixture",
        livemode: true,
        status: "succeeded",
        currency: "usd",
        amount_received: 3495,
        latest_charge: {
          payment_intent: "pi_fixture",
          livemode: true,
          paid: true,
          refunded: true,
          amount_refunded: 3495,
        },
      } as never)
    if (change === "artwork")
      vi.mocked(readCheckoutProduct).mockResolvedValue({
        id: fixture.productId,
        title: "Changed",
        variants: [
          { id: 101, unitAmount: 3000, label: "Forest / M", available: true, fingerprint: "different-artwork" },
        ],
      })
    const request = vi.spyOn(fixture.printify, "request")
    await expect(fulfillCheckout(fixture.services, fixture.sessionId)).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
    expect(fixture.getStored()?.failureCode).toBeTruthy()
  })

  it("recovers a lost create response by finding the existing order, without recreating it", async () => {
    const fixture = checkoutFixture()
    const request = vi.spyOn(fixture.printify, "request").mockRejectedValueOnce(new Error("socket lost"))
    await expect(fulfillCheckout(fixture.services, fixture.sessionId)).rejects.toThrow()
    expect(fixture.getStored()?.state).toBe("creating")
    request
      .mockResolvedValueOnce({ current_page: 1, last_page: 1, data: [fixture.providerOrder] })
      .mockResolvedValueOnce(null)
    expect(await fulfillCheckout(fixture.services, fixture.sessionId)).toBe("submitted")
    expect(request.mock.calls.filter(([path, body]) => path === "orders.json" && body)).toHaveLength(1)
  })

  it("does not retry an ambiguous create when reconciliation finds no order", async () => {
    const fixture = checkoutFixture()
    fixture.setStored({ ...fixture.getStored()!, state: "creating" })
    const request = vi.spyOn(fixture.printify, "request").mockResolvedValue({ current_page: 1, last_page: 1, data: [] })
    await expect(fulfillCheckout(fixture.services, fixture.sessionId)).rejects.toMatchObject({
      code: "ORDER_CREATE_UNCERTAIN",
    })
    expect(request.mock.calls.every(([, body]) => body === undefined)).toBe(true)
  })

  it("reconciles a lost production response without sending to production a second time", async () => {
    const fixture = checkoutFixture()
    const request = vi
      .spyOn(fixture.printify, "request")
      .mockResolvedValueOnce({ id: "printify-order" })
      .mockResolvedValueOnce(fixture.providerOrder)
      .mockRejectedValueOnce(new Error("socket lost"))
    await expect(fulfillCheckout(fixture.services, fixture.sessionId)).rejects.toThrow()
    expect(fixture.getStored()?.state).toBe("submitting")
    request.mockResolvedValueOnce({ ...fixture.providerOrder, status: "in-production" })
    expect(await fulfillCheckout(fixture.services, fixture.sessionId)).toBe("submitted")
    expect(request.mock.calls.filter(([path]) => path.endsWith("send_to_production.json"))).toHaveLength(1)
  })

  it("keeps uncertain production on hold when the provider cannot confirm it", async () => {
    const fixture = checkoutFixture()
    fixture.setStored({ ...fixture.getStored()!, state: "submitting", printifyOrderId: "printify-order" })
    const request = vi.spyOn(fixture.printify, "request").mockResolvedValue(fixture.providerOrder)
    await expect(fulfillCheckout(fixture.services, fixture.sessionId)).rejects.toMatchObject({
      code: "PRODUCTION_UNCERTAIN",
    })
    expect(request.mock.calls.every(([, body]) => body === undefined)).toBe(true)
  })

  it("fails closed for a different Printify destination or item response", async () => {
    const fixture = checkoutFixture()
    fixture.setStored({ ...fixture.getStored()!, state: "created", printifyOrderId: "printify-order" })
    const request = vi.spyOn(fixture.printify, "request").mockResolvedValue({
      ...fixture.providerOrder,
      address_to: { ...fixture.providerOrder.address_to, zip: "90210" },
    })
    await expect(fulfillCheckout(fixture.services, fixture.sessionId)).rejects.toMatchObject({ code: "ORDER_MISMATCH" })
    expect(request.mock.calls.every(([, body]) => body === undefined)).toBe(true)
  })
  it("recognizes a production submission despite later stock or artwork changes", async () => {
    const fixture = checkoutFixture()
    fixture.setStored({ ...fixture.getStored()!, state: "submitting", printifyOrderId: "printify-order" })
    vi.mocked(readCheckoutProduct).mockRejectedValue(new Error("draft no longer available"))
    const request = vi
      .spyOn(fixture.printify, "request")
      .mockResolvedValue({ ...fixture.providerOrder, status: "in-production" })
    expect(await fulfillCheckout(fixture.services, fixture.sessionId)).toBe("submitted")
    expect(readCheckoutProduct).not.toHaveBeenCalled()
    expect(request.mock.calls.every(([, body]) => body === undefined)).toBe(true)
  })

  it("refuses to send an existing order to a changed recipient", async () => {
    const fixture = checkoutFixture()
    fixture.setStored({ ...fixture.getStored()!, state: "created", printifyOrderId: "printify-order" })
    const request = vi.spyOn(fixture.printify, "request").mockResolvedValue({
      ...fixture.providerOrder,
      address_to: { ...fixture.providerOrder.address_to, first_name: "Someone Else" },
    })
    await expect(fulfillCheckout(fixture.services, fixture.sessionId)).rejects.toMatchObject({ code: "ORDER_MISMATCH" })
    expect(request.mock.calls.every(([, body]) => body === undefined)).toBe(true)
  })
})

function checkoutFixture() {
  const requestId = randomUUID()
  const sessionId = "cs_test_fixture12345678901234567890"
  const productId = "111111000000000000000002"
  const order: CheckoutOrder = {
    requestId,
    commerceIdentity: "fixture-store-commerce",
    requestFingerprint: "fingerprint",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    shopId: "1234",
    currency: "usd",
    subtotal: 3000,
    shippingAmount: 495,
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
    items: [
      {
        productId,
        variantId: 101,
        quantity: 1,
        unitAmount: 3000,
        title: "Toast to Small Wins",
        variantLabel: "Forest / M",
        productFingerprint: `v2:${"a".repeat(64)}`,
      },
    ],
  }
  let stored: StoredOrder | null = {
    order,
    sessionId,
    checkoutUrl: "https://checkout.stripe.com/c/pay/test",
    state: "pending",
    printifyOrderId: null,
    failureCode: null,
    payment: null,
  }
  const savePayment = vi.fn(async (payment: CheckoutPayment) => {
    if (stored && !stored.payment) stored = { ...stored, payment }
  })
  const ensureCommerceIdentity = vi.fn(async () => {})
  const store: OrderStore = {
    withLock: async (_id, callback) =>
      callback({
        ensureCommerceIdentity,
        get: async () => stored,
        insert: async (newOrder) => {
          stored = {
            order: newOrder,
            sessionId: null,
            checkoutUrl: null,
            state: "pending",
            printifyOrderId: null,
            failureCode: null,
            payment: null,
          }
        },
        update: async (patch) => {
          if (stored) stored = { ...stored, ...patch }
        },
        savePayment,
        saveShippingAddress: async (shippingAddress) => {
          if (stored) stored = { ...stored, order: { ...stored.order, shippingAddress } }
        },
      }),
    findBySession: async () => stored,
  }
  const session = {
    id: sessionId,
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    livemode: true,
    currency: "usd",
    amount_subtotal: 3000,
    amount_total: 3000 + order.shippingAmount,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    total_details: { amount_shipping: order.shippingAmount, amount_discount: 0, amount_tax: 0 },
    metadata: { storefront: "fixture-store-commerce", checkout_request_id: requestId, shop_id: "1234" },
    client_reference_id: requestId,
    payment_intent: "pi_fixture",
    shipping_cost: {
      amount_subtotal: order.shippingAmount,
      amount_tax: 0,
      amount_total: order.shippingAmount,
      shipping_rate: "shr_fixture",
    },
    collected_information: {
      shipping_details: {
        name: "Robin Sample",
        address: {
          country: "US",
          state: "MN",
          city: "Minneapolis",
          line1: "123 Test Street",
          line2: null,
          postal_code: "55401",
        },
      } as Stripe.Checkout.Session.CollectedInformation.ShippingDetails | null,
    },
    customer_details: { name: "Robin Sample", email: "robin@example.com", phone: "+16125550101" },
  }
  const line = {
    quantity: 1,
    currency: "usd",
    amount_subtotal: 3000,
    price: { unit_amount: 3000, product: { metadata: { product_id: productId, variant_id: "101" } } },
  }
  const stripe = {
    checkout: {
      sessions: {
        retrieve: vi.fn(async () => session),
        listLineItems: vi.fn(async () => ({
          data: [line],
          has_more: false,
        })),
        create: vi.fn(async () => ({ id: sessionId, url: "https://checkout.stripe.com/c/pay/test", livemode: false })),
        expire: vi.fn(async () => ({ id: sessionId, status: "expired" })),
      },
    },
    paymentIntents: {
      retrieve: vi.fn(async () => ({
        id: "pi_fixture",
        livemode: session.livemode,
        status: "succeeded",
        currency: "usd",
        amount_received: 3000 + order.shippingAmount,
        latest_charge: {
          payment_intent: "pi_fixture",
          livemode: session.livemode,
          created: 1789999200,
          amount: 3000 + order.shippingAmount,
          amount_captured: 3000 + order.shippingAmount,
          currency: "usd",
          captured: true,
          paid: true,
          refunded: false,
          amount_refunded: 0,
          disputed: false,
        },
      })),
    },
    shippingRates: {
      retrieve: vi.fn(async () => ({
        id: "shr_fixture",
        type: "fixed_amount",
        fixed_amount: { amount: order.shippingAmount, currency: "usd" },
        tax_behavior: "exclusive",
        metadata: { kind: "shipping", checkout_request_id: requestId },
      })),
    },
    customers: { create: vi.fn(async () => ({ id: "cus_fixture" })) },
    tax: {
      settings: { retrieve: vi.fn(async () => ({ status: "active" })) },
      registrations: { list: vi.fn(async () => ({ data: [{ id: "taxreg_test" }] })) },
    },
  } as unknown as Stripe
  const printify = new PrintifyClient({ apiToken: "test-secret-not-real", shopId: "1234" })
  delete order.shippingAddress
  const providerOrder = {
    id: "printify-order",
    status: "on-hold",
    metadata: { shop_order_id: sessionId },
    line_items: [{ product_id: productId, variant_id: 101, quantity: 1, status: "pending" }],
    address_to: {
      first_name: "Robin",
      last_name: "Sample",
      email: "robin@example.com",
      phone: "+16125550101",
      country: "US",
      region: "MN",
      city: "Minneapolis",
      address1: "123 Test Street",
      address2: "",
      zip: "55401",
    },
  }
  return {
    order,
    ensureCommerceIdentity,
    sessionId,
    session,
    line,
    productId,
    stripe,
    store,
    printify,
    providerOrder,
    savePayment,
    getStored: () => stored,
    setStored: (value: StoredOrder | null) => {
      stored = value
    },
    services: {
      stripe,
      store,
      printify,
      liveFulfillment: true,
      siteUrl: "https://shop.example.com",
      automaticTax: false,
      expectedLivemode: false,
    },
  }
}
