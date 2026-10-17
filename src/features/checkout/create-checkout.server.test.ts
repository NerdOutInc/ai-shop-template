import { storeConfig } from "@/lib/store-config"
import "../../../test/configured-store"
import { randomUUID } from "node:crypto"
import type Stripe from "stripe"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { readPublishedProduct } from "@/features/publishing/read-published-product.server"

import type { OrderAttribution } from "@/features/attribution/order-attribution-schema"

import type { CheckoutOrder, OrderStore, StoredOrder } from "./checkout-order"
import { PrintifyClient } from "./printify-client.server"

import { createCheckout } from "./create-checkout.server"
import { readCheckoutItems } from "./read-checkout-items.server"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/env", () => ({ env: { PRINTIFY_PUBLISHING_ENABLED: true } }))
vi.mock("@/features/publishing/read-published-product.server", () => ({ readPublishedProduct: vi.fn() }))
vi.mock("./read-checkout-items.server", () => ({ readCheckoutItems: vi.fn() }))

beforeEach(() => {
  vi.mocked(readCheckoutItems).mockReset()
  vi.mocked(readPublishedProduct).mockReset()
})

describe("createCheckout", () => {
  it.each([
    [495, 0],
    [0, 795],
  ])("retains saved shipping %s after a lost Stripe response and a new %s policy", async (originalRate, nextRate) => {
    const fixture = await realReaderFixture()
    storeConfig.commerce.firstItemShippingCents = originalRate
    fixture.request.expectedShippingAmount = originalRate
    vi.mocked(fixture.stripe.checkout.sessions.create).mockRejectedValueOnce(new Error("response lost"))
    await expect(createCheckout(fixture.services, fixture.request)).rejects.toThrow("response lost")
    const savedOrder = structuredClone(fixture.getStored()?.order)
    storeConfig.commerce.firstItemShippingCents = nextRate
    await createCheckout(fixture.services, fixture.request)
    const calls = vi.mocked(fixture.stripe.checkout.sessions.create).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[1]).toEqual(calls[0])
    expect(calls[1]![0]?.shipping_options?.[0]?.shipping_rate_data?.fixed_amount?.amount).toBe(originalRate)
    expect(fixture.getStored()?.order).toEqual(savedOrder)
    expect(fixture.providerRead).toHaveBeenCalledTimes(2)
    expect(readPublishedProduct).toHaveBeenCalledTimes(2)
  })

  it("rejects a stale shipping quote for a new order through the real reader", async () => {
    const fixture = await realReaderFixture()
    storeConfig.commerce.firstItemShippingCents = 795
    await expect(createCheckout(fixture.services, fixture.request)).rejects.toMatchObject({ code: "SHIPPING_CHANGED" })
    expect(fixture.getStored()).toBeNull()
    expect(fixture.stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it.each([
    ["price", "PRICE_CHANGED"],
    ["availability", "PRODUCT_UNAVAILABLE"],
    ["artwork", "PRODUCT_CHANGED"],
  ])("rechecks %s on a saved retry through the real reader", async (change, code) => {
    const fixture = await realReaderFixture()
    vi.mocked(fixture.stripe.checkout.sessions.create).mockRejectedValueOnce(new Error("response lost"))
    await expect(createCheckout(fixture.services, fixture.request)).rejects.toThrow("response lost")
    storeConfig.commerce.firstItemShippingCents = 0
    if (change === "price") fixture.published.variants[0]!.price += 100
    if (change === "availability") fixture.live.variants[0]!.is_available = false
    if (change === "artwork") fixture.live.print_areas[0]!.placeholders[0]!.images[0]!.id = "different-artwork"
    await expect(createCheckout(fixture.services, fixture.request)).rejects.toMatchObject({ code })
    expect(fixture.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1)
  })

  it.each(["configured", "policies", "shipping"])("blocks the %s gate before checkout side effects", async (gate) => {
    const fixture = hostedFixture()
    if (gate === "configured") storeConfig.configured = false
    if (gate === "policies") storeConfig.policies.published = false
    if (gate === "shipping") storeConfig.commerce.shippingConfirmed = false
    await expect(createCheckout(fixture.services, fixture.request)).rejects.toMatchObject({
      code: "STORE_SETUP_REQUIRED",
    })
    expect(fixture.ensureCommerceIdentity).not.toHaveBeenCalled()
    expect(fixture.services.capacity.reserveProviderReads).not.toHaveBeenCalled()
    expect(readCheckoutItems).not.toHaveBeenCalled()
    expect(fixture.stripe.checkout.sessions.create).not.toHaveBeenCalled()
    expect(fixture.getStored()).toBeNull()
  })

  it("writes the permanent commerce identity independently of the editable brand ID", async () => {
    const fixture = hostedFixture()
    storeConfig.id = "second-brand"
    storeConfig.commerce.identity = "permanent-store"
    await createCheckout(fixture.services, fixture.request)
    expect(fixture.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ storefront: "permanent-store" }),
        payment_intent_data: { metadata: expect.objectContaining({ storefront: "permanent-store" }) },
      }),
      expect.anything()
    )
  })

  it("keeps the original Stripe identity and payload after a lost response and rebrand", async () => {
    const fixture = hostedFixture()
    vi.mocked(fixture.stripe.checkout.sessions.create).mockRejectedValueOnce(new Error("response lost"))
    await expect(createCheckout(fixture.services, fixture.request)).rejects.toThrow("response lost")
    storeConfig.id = "fresh-brand"
    storeConfig.name = "Fresh Brand"
    storeConfig.commerce.identity = "accidental-config-change"
    await createCheckout(fixture.services, fixture.request)
    const calls = vi.mocked(fixture.stripe.checkout.sessions.create).mock.calls
    expect(calls[1]).toEqual(calls[0])
    expect(fixture.getStored()?.order.commerceIdentity).toBe("fixture-store-commerce")
    expect(fixture.ensureCommerceIdentity).toHaveBeenCalledExactlyOnceWith("fixture-store-commerce")
  })

  it("rejects changed commerce identity before catalog reads or Stripe creation", async () => {
    const fixture = hostedFixture()
    vi.mocked(fixture.ensureCommerceIdentity).mockRejectedValueOnce({ code: "COMMERCE_IDENTITY_CHANGED" })
    await expect(createCheckout(fixture.services, fixture.request)).rejects.toMatchObject({
      code: "COMMERCE_IDENTITY_CHANGED",
    })
    expect(readCheckoutItems).not.toHaveBeenCalled()
    expect(fixture.services.capacity.reserveProviderReads).not.toHaveBeenCalled()
    expect(fixture.stripe.checkout.sessions.create).not.toHaveBeenCalled()
    expect(fixture.getStored()).toBeNull()
  })

  it("does not guess a commerce identity for an incomplete saved snapshot", async () => {
    const fixture = hostedFixture()
    vi.mocked(fixture.stripe.checkout.sessions.create).mockRejectedValueOnce(new Error("response lost"))
    await expect(createCheckout(fixture.services, fixture.request)).rejects.toThrow("response lost")
    Reflect.deleteProperty(fixture.getStored()!.order, "commerceIdentity")
    await expect(createCheckout(fixture.services, fixture.request)).rejects.toMatchObject({
      code: "ORDER_IDENTITY_MISSING",
    })
    expect(fixture.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1)
  })

  it("reserves provider-read capacity before a quote and retains a claim after provider failure", async () => {
    const fixture = hostedFixture()
    vi.mocked(readCheckoutItems).mockImplementationOnce(async (...args) => {
      await args[2](1)
      throw new Error("provider unavailable")
    })
    await expect(createCheckout(fixture.services, fixture.request)).rejects.toThrow("provider unavailable")
    expect(fixture.services.capacity.reserveProviderReads).toHaveBeenCalledExactlyOnceWith(1)
    await createCheckout(fixture.services, fixture.request)
    expect(fixture.services.capacity.reserveProviderReads).toHaveBeenCalledTimes(2)
  })

  it("resumes an open saved session without spending provider-read capacity", async () => {
    const fixture = hostedFixture()
    await createCheckout(fixture.services, fixture.request)
    fixture.services.capacity.reserveProviderReads.mockRejectedValue({ code: "CHECKOUT_RATE_LIMITED" })
    const result = await createCheckout(fixture.services, fixture.request)
    expect(result.sessionId).toBe(fixture.sessionId)
    expect(fixture.services.capacity.reserveProviderReads).toHaveBeenCalledTimes(1)
    expect(readCheckoutItems).toHaveBeenCalledTimes(1)
    expect(fixture.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1)
  })

  it("throttles saved-session Stripe reads while retaining the saved retry", async () => {
    const fixture = hostedFixture()
    await createCheckout(fixture.services, fixture.request)
    const saved = structuredClone(fixture.getStored())
    fixture.services.capacity.reserveStripeRead.mockRejectedValueOnce({ code: "CHECKOUT_RATE_LIMITED" })
    await expect(createCheckout(fixture.services, fixture.request)).rejects.toMatchObject({
      code: "CHECKOUT_RATE_LIMITED",
    })
    expect(fixture.services.capacity.reserveStripeRead).toHaveBeenCalledExactlyOnceWith(fixture.sessionId)
    expect(fixture.stripe.checkout.sessions.retrieve).not.toHaveBeenCalled()
    expect(fixture.getStored()).toEqual(saved)
    await expect(createCheckout(fixture.services, fixture.request)).resolves.toMatchObject({
      sessionId: fixture.sessionId,
    })
  })

  it("stops before provider reads when the shared capacity budget is exhausted", async () => {
    const fixture = hostedFixture()
    fixture.services.capacity.reserveProviderReads.mockRejectedValueOnce({ code: "CHECKOUT_RATE_LIMITED" })
    await expect(createCheckout(fixture.services, fixture.request)).rejects.toMatchObject({
      code: "CHECKOUT_RATE_LIMITED",
    })
    expect(fixture.getStored()).toBeNull()
    expect(fixture.stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it("freezes the shipping window on the original checkout, including retries after a policy change", async () => {
    const fixture = hostedFixture()
    vi.mocked(fixture.stripe.checkout.sessions.create).mockRejectedValueOnce(new Error("response lost"))
    await expect(createCheckout(fixture.services, fixture.request)).rejects.toThrow("response lost")
    const original = fixture.getStored()!
    expect(original.order.shippingEstimate).toEqual({
      handlingBusinessDays: 10,
      calendar: "us-federal-v1",
      timeZone: "America/Chicago",
    })
    original.order.shippingEstimate = { handlingBusinessDays: 7, calendar: "us-federal-v1", timeZone: "UTC" }
    await createCheckout(fixture.services, fixture.request)
    expect(fixture.getStored()?.order.shippingEstimate).toEqual({
      handlingBusinessDays: 7,
      calendar: "us-federal-v1",
      timeZone: "UTC",
    })
  })

  it("freezes attribution before Stripe and preserves the original payload when a response is lost", async () => {
    const fixture = hostedFixture()
    const attribution: OrderAttribution = {
      version: 1,
      capturedAt: new Date().toISOString(),
      channel: "social",
      source: "instagram",
      referrerHost: "instagram.com",
      utmSource: "instagram",
      utmMedium: "social",
      utmCampaign: "autumn_drop",
      landingPath: "/shop",
      method: "campaign",
    }
    vi.mocked(fixture.stripe.checkout.sessions.create).mockRejectedValueOnce(new Error("response lost"))
    await expect(createCheckout(fixture.services, { ...fixture.request, attribution })).rejects.toThrow("response lost")
    expect(fixture.getStored()?.order.attribution).toEqual(attribution)
    await createCheckout(fixture.services, {
      ...fixture.request,
      attribution: { ...attribution, source: "facebook", capturedAt: new Date(Date.now() + 1_000).toISOString() },
    })
    const calls = vi.mocked(fixture.stripe.checkout.sessions.create).mock.calls
    expect(calls[1]).toEqual(calls[0])
    expect(fixture.getStored()?.order.attribution).toEqual(attribution)
    expect(JSON.stringify(calls[0])).not.toContain("autumn_drop")
  })

  it("does not retroactively guess attribution for an existing checkout snapshot", async () => {
    const fixture = hostedFixture()
    vi.mocked(fixture.stripe.checkout.sessions.create).mockRejectedValueOnce(new Error("response lost"))
    await expect(createCheckout(fixture.services, fixture.request)).rejects.toThrow("response lost")
    await createCheckout(fixture.services, {
      ...fixture.request,
      attribution: {
        version: 1,
        capturedAt: new Date().toISOString(),
        channel: "direct",
        source: null,
        referrerHost: null,
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
        landingPath: "/cart",
        method: "direct",
      },
    })
    expect(fixture.getStored()?.order).not.toHaveProperty("attribution")
  })

  it("stops before creating a payment session when the live stock check rejects an item", async () => {
    const fixture = hostedFixture()
    vi.mocked(readCheckoutItems).mockRejectedValueOnce(
      Object.assign(new Error("Selected size sold out"), { code: "PRODUCT_UNAVAILABLE" })
    )
    await expect(createCheckout(fixture.services, fixture.request)).rejects.toMatchObject({
      code: "PRODUCT_UNAVAILABLE",
    })
    expect(readCheckoutItems).toHaveBeenCalledExactlyOnceWith(fixture.printify, fixture.request, expect.any(Function))
    expect(fixture.stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it("opens address-free hosted checkout with authoritative flat shipping and no Printify shipping quote", async () => {
    const fixture = hostedFixture(3)
    const providerRequest = vi.spyOn(fixture.printify, "request")
    await createCheckout(fixture.services, fixture.request)

    expect(readCheckoutItems).toHaveBeenCalledWith(fixture.printify, fixture.request, expect.any(Function))
    expect(providerRequest).not.toHaveBeenCalled()
    expect(fixture.stripe.customers.create).not.toHaveBeenCalled()
    expect(fixture.getStored()?.order).toMatchObject({
      shippingMode: "flat_rate",
      subtotal: 9000,
      shippingAmount: 975,
    })
    expect(fixture.getStored()?.order).not.toHaveProperty("shippingAddress")
    const params = vi.mocked(fixture.stripe.checkout.sessions.create).mock.calls[0]![0]
    expect(params).toMatchObject({
      shipping_address_collection: { allowed_countries: ["US"] },
      phone_number_collection: { enabled: true },
      automatic_tax: { enabled: false },
      adaptive_pricing: { enabled: false },
      line_items: [{ quantity: 3, price_data: { unit_amount: 3000 } }],
      shipping_options: [
        {
          shipping_rate_data: {
            type: "fixed_amount",
            display_name: "Standard shipping",
            fixed_amount: { amount: 975, currency: "usd" },
            tax_behavior: "exclusive",
            tax_code: "txcd_92010001",
            metadata: { kind: "shipping", checkout_request_id: fixture.order.requestId },
          },
        },
      ],
    })
    expect(params?.line_items).toHaveLength(1)
    expect(params).not.toHaveProperty("customer")
    expect(params).not.toHaveProperty("customer_email")
    expect(params).not.toHaveProperty("payment_method_types")
  })

  it("rejects a tampered flat shipping amount before persisting or contacting Stripe", async () => {
    const fixture = hostedFixture()
    await expect(
      createCheckout(fixture.services, { ...fixture.request, expectedShippingAmount: 1 })
    ).rejects.toMatchObject({
      code: "SHIPPING_CHANGED",
    })
    expect(fixture.getStored()).toBeNull()
    expect(fixture.stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it("saves each variant photo and sends it on the matching Stripe line item", async () => {
    const fixture = hostedFixture()
    const items = [
      { ...fixture.order.items[0]!, imageUrl: "https://images.printify.com/forest-front.jpg" },
      {
        ...fixture.order.items[0]!,
        variantId: 102,
        variantLabel: "Black / M",
        imageUrl: "https://images.printify.com/black-front.jpg",
      },
    ]
    vi.mocked(readCheckoutItems).mockResolvedValue(items)
    await createCheckout(fixture.services, {
      ...fixture.request,
      expectedShippingAmount: 735,
      items: items.map((item) => ({
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        expectedUnitAmount: item.unitAmount,
      })),
    })

    const params = vi.mocked(fixture.stripe.checkout.sessions.create).mock.calls[0]![0]
    expect(fixture.getStored()?.order.items).toEqual(items)
    expect(params?.line_items?.map((item) => item.price_data?.product_data)).toEqual(
      items.map((item) => ({
        name: `${item.title} — ${item.variantLabel}`,
        images: [item.imageUrl],
        metadata: { product_id: item.productId, variant_id: String(item.variantId) },
      }))
    )
  })

  it("opens checkout without an image when no matching photo is available", async () => {
    const fixture = hostedFixture()
    await createCheckout(fixture.services, fixture.request)
    const params = vi.mocked(fixture.stripe.checkout.sessions.create).mock.calls[0]![0]
    expect(params?.line_items?.[0]?.price_data?.product_data).not.toHaveProperty("images")
  })

  it("preserves the address-free Stripe payload and idempotency key after a lost response", async () => {
    const fixture = hostedFixture()
    vi.mocked(readCheckoutItems).mockResolvedValue([
      { ...fixture.order.items[0]!, imageUrl: "https://images.printify.com/original-photo.jpg" },
    ])
    vi.mocked(fixture.stripe.checkout.sessions.create).mockRejectedValueOnce(new Error("response lost"))
    await expect(createCheckout(fixture.services, fixture.request)).rejects.toThrow("response lost")
    const savedOrder = structuredClone(fixture.getStored()?.order)
    vi.mocked(readCheckoutItems).mockResolvedValue([
      {
        ...fixture.order.items[0]!,
        title: "Updated listing title",
        imageUrl: "https://images.printify.com/updated-photo.jpg",
      },
    ])
    await createCheckout(fixture.services, fixture.request)
    const calls = vi.mocked(fixture.stripe.checkout.sessions.create).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[1]).toEqual(calls[0])
    expect(calls[1]![0]?.line_items?.[0]?.price_data?.product_data?.images).toEqual([
      "https://images.printify.com/original-photo.jpg",
    ])
    expect(calls[1]![1]).toEqual({ idempotencyKey: `store-checkout-${fixture.order.requestId}` })
    expect(fixture.getStored()?.order).toEqual(savedOrder)
    expect(fixture.stripe.customers.create).not.toHaveBeenCalled()
  })

  it("blocks a hosted checkout retry when its saved production fingerprint changed", async () => {
    const fixture = hostedFixture()
    vi.mocked(fixture.stripe.checkout.sessions.create).mockRejectedValueOnce(new Error("response lost"))
    await expect(createCheckout(fixture.services, fixture.request)).rejects.toThrow("response lost")
    vi.mocked(readCheckoutItems).mockResolvedValue([
      { ...fixture.order.items[0]!, productFingerprint: "different-artwork" },
    ])
    await expect(createCheckout(fixture.services, fixture.request)).rejects.toMatchObject({ code: "PRODUCT_CHANGED" })
    expect(fixture.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1)
  })

  it("keeps tax registration and live fulfillment guards on the hosted flow", async () => {
    const fixture = hostedFixture()
    await expect(
      createCheckout({ ...fixture.services, expectedLivemode: true, liveFulfillment: false }, fixture.request)
    ).rejects.toMatchObject({ code: "FULFILLMENT_DISABLED" })
    vi.mocked(fixture.stripe.tax.registrations.list).mockResolvedValue({ data: [] } as never)
    await expect(createCheckout({ ...fixture.services, automaticTax: true }, fixture.request)).rejects.toMatchObject({
      code: "TAX_NOT_CONFIGURED",
    })
    expect(fixture.stripe.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it("reuses an open session and rejects a changed request", async () => {
    const f = hostedFixture()
    const first = await createCheckout(f.services, f.request)
    expect(await createCheckout(f.services, f.request)).toEqual(first)
    await expect(createCheckout(f.services, { ...f.request, expectedShippingAmount: 1 })).rejects.toMatchObject({
      code: "REQUEST_CONFLICT",
    })
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1)
  })
  it.each(["expired", "mode", "complete"])("handles a saved %s session", async (state) => {
    const f = hostedFixture()
    await createCheckout(f.services, f.request)
    if (state === "expired") {
      f.session.status = "expired"
      await expect(createCheckout(f.services, f.request)).rejects.toMatchObject({ code: "REQUEST_EXPIRED" })
    } else if (state === "mode") {
      f.session.livemode = true
      await expect(createCheckout(f.services, f.request)).rejects.toMatchObject({ code: "CHECKOUT_MODE_MISMATCH" })
      expect(f.stripe.checkout.sessions.expire).toHaveBeenCalledWith(f.sessionId)
    } else {
      f.session.status = "complete"
      expect(await createCheckout(f.services, f.request)).toEqual({
        url: `${f.services.siteUrl}/checkout/success?session_id=${f.sessionId}`,
        sessionId: f.sessionId,
      })
    }
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1)
  })
  it("rejects a snapshot too close to expiry after a lost response", async () => {
    const f = hostedFixture()
    vi.mocked(f.stripe.checkout.sessions.create).mockRejectedValueOnce(new Error("response lost"))
    await expect(createCheckout(f.services, f.request)).rejects.toThrow("response lost")
    f.getStored()!.order.expiresAt = Math.floor(Date.now() / 1000) + 100
    await expect(createCheckout(f.services, f.request)).rejects.toMatchObject({ code: "REQUEST_EXPIRED" })
    expect(f.stripe.checkout.sessions.create).toHaveBeenCalledTimes(1)
  })
  it("expires an unexpectedly live newly created session", async () => {
    const f = hostedFixture()
    vi.mocked(f.stripe.checkout.sessions.create).mockResolvedValueOnce({
      id: f.sessionId,
      url: "https://checkout.stripe.com/test",
      livemode: true,
    } as never)
    await expect(createCheckout(f.services, f.request)).rejects.toMatchObject({ code: "CHECKOUT_MODE_MISMATCH" })
    expect(f.stripe.checkout.sessions.expire).toHaveBeenCalledWith(f.sessionId)
    expect(f.getStored()!.sessionId).toBeNull()
  })
})

async function realReaderFixture() {
  const fixture = hostedFixture()
  const published = {
    id: fixture.productId,
    shop_id: 1234,
    title: "Sample Morning Scene",
    blueprint_id: 1317,
    print_provider_id: 99,
    images: [],
    print_areas: [
      {
        variant_ids: [101],
        placeholders: [{ position: "front", images: [{ id: "approved-artwork", x: 0.5, y: 0.4, scale: 1, angle: 0 }] }],
      },
    ],
    variants: [{ id: 101, price: 3000, is_enabled: true, is_available: true, options: [1] }],
    options: [{ name: "Size", values: [{ id: 1, title: "M" }] }],
  }
  const live = structuredClone(published)
  vi.mocked(readPublishedProduct).mockResolvedValue(published)
  const providerRead = vi.spyOn(fixture.printify, "request").mockResolvedValue(live)
  const actual = await vi.importActual<typeof import("./read-checkout-items.server")>("./read-checkout-items.server")
  vi.mocked(readCheckoutItems).mockImplementation(actual.readCheckoutItems)
  return { ...fixture, published, live, providerRead }
}

function hostedFixture(quantity = 1) {
  const fixture = checkoutFixture()
  fixture.setStored(null)
  fixture.order.items[0]!.productFingerprint = `v2:${"b".repeat(64)}`
  const items = [{ ...fixture.order.items[0]!, quantity }]
  vi.mocked(readCheckoutItems).mockImplementation(async (...args) => {
    await args[2](new Set(args[1].items.map((item) => item.productId)).size)
    return items
  })
  const request = {
    items: [{ productId: fixture.productId, variantId: 101, quantity, expectedUnitAmount: 3000 }],
    requestId: fixture.order.requestId,
    expectedShippingAmount: 495 + (quantity - 1) * 240,
  }
  return { ...fixture, request }
}

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
    items: [
      {
        productId,
        variantId: 101,
        quantity: 1,
        unitAmount: 3000,
        title: "Sample Morning Scene",
        variantLabel: "Forest / M",
        productFingerprint: "artwork-v1",
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
        savePayment: async (payment) => {
          if (stored && !stored.payment) stored = { ...stored, payment }
        },
        saveShippingAddress: async () => {
          throw new Error("Checkout creation must not capture a delivery address")
        },
      }),
    findBySession: async () => stored,
  }
  const session = {
    id: sessionId,
    mode: "payment",
    status: "open",
    payment_status: "unpaid",
    livemode: false,
    currency: "usd",
    amount_subtotal: 3499,
    amount_total: 3499,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    total_details: { amount_shipping: 0, amount_discount: 0, amount_tax: 0 },
    metadata: { storefront: "fixture-store-commerce", checkout_request_id: requestId, shop_id: "1234" },
    client_reference_id: requestId,
    payment_intent: "pi_fixture",
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
          data: [
            line,
            {
              quantity: 1,
              currency: "usd",
              amount_subtotal: 499,
              price: { unit_amount: 499, product: { metadata: { kind: "shipping", checkout_request_id: requestId } } },
            },
          ],
          has_more: false,
        })),
        create: vi.fn(async () => ({ id: sessionId, url: "https://checkout.stripe.com/c/pay/test", livemode: false })),
        expire: vi.fn(async () => ({ id: sessionId, status: "expired" })),
      },
    },
    paymentIntents: {
      retrieve: vi.fn(async () => ({
        status: "succeeded",
        currency: "usd",
        amount_received: 3499,
        latest_charge: { paid: true, refunded: false, amount_refunded: 0, disputed: false },
      })),
    },
    customers: { create: vi.fn(async () => ({ id: "cus_fixture" })) },
    tax: {
      settings: { retrieve: vi.fn(async () => ({ status: "active" })) },
      registrations: { list: vi.fn(async () => ({ data: [{ id: "taxreg_test" }] })) },
    },
  } as unknown as Stripe
  const printify = new PrintifyClient({ apiToken: "test-secret-not-real", shopId: "1234" })
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
      capacity: { reserveStripeRead: vi.fn(async () => undefined), reserveProviderReads: vi.fn(async () => {}) },
    },
  }
}
