// @vitest-environment node
import { randomUUID } from "node:crypto"
import type Stripe from "stripe"
import { applyAllMigrations } from "../../../test/apply-all-migrations"
import { createAdminDatabaseFixture } from "../../../test/create-admin-database-fixture"

import { Pool } from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import type { CheckoutOrder, CheckoutPayment, OrderStore, StoredOrder } from "./checkout-order"
import { PrintifyClient } from "./printify-client.server"

import { fulfillCheckout } from "./fulfill-checkout.server"
import { PostgresOrderStore } from "./postgres-order-store.server"
import { readCheckoutProduct } from "./read-checkout-product.server"

vi.mock("server-only", () => ({}))
vi.mock("./read-checkout-product.server", () => ({ readCheckoutProduct: vi.fn() }))

const databaseUrl = process.env.CHECKOUT_TEST_DATABASE_URL

describe("Postgres connection safety", () => {
  it.each([
    "",
    "?sslmode=disable",
    "?sslmode=no-verify",
    "?sslmode=require",
    "?sslmode=prefer",
    "?sslmode=verify-ca",
    "?sslmode=verify-full&sslmode=disable",
  ])("rejects unverified remote transport %s", (query) => {
    expect(() => new PostgresOrderStore(`postgresql://user:password@db.example.com:5432/postgres${query}`)).toThrow()
  })

  it("rejects URL overrides that bypass host/port validation", () => {
    expect(
      () => new PostgresOrderStore("postgresql://user:password@localhost:5432/postgres?host=db.example.com")
    ).toThrow()
    expect(
      () =>
        new PostgresOrderStore("postgresql://user:password@db.example.com:5432/postgres?sslmode=verify-full&port=6543")
    ).toThrow()
  })

  it("accepts certificate-verified remote transport without opening a connection", async () => {
    const store = new PostgresOrderStore("postgresql://user:password@db.example.com:5432/postgres?sslmode=verify-full")
    await store.close()
  })
})

describe.skipIf(!databaseUrl)("Postgres checkout durability", () => {
  let pool: Pool
  let firstStore: PostgresOrderStore
  let secondStore: PostgresOrderStore

  beforeAll(async () => {
    const url = new URL(databaseUrl!)
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/store_commerce_test")
      throw new Error("Use an isolated local store_commerce_test database")
    pool = await createAdminDatabaseFixture(databaseUrl!)
    await applyAllMigrations(pool)
    firstStore = new PostgresOrderStore(databaseUrl!)
    secondStore = new PostgresOrderStore(databaseUrl!)
  })

  afterAll(async () => {
    await firstStore?.close()
    await secondStore?.close()
    await pool?.end()
  })

  it("keeps the function alive for idle cleanup only after releasing the checkout lock", async () => {
    const pending: Promise<unknown>[] = []
    vi.stubEnv("VERCEL_URL", "checkout-pool-test.vercel.app")
    vi.stubEnv("VERCEL_REGION", "iad1")
    vi.stubGlobal(Symbol.for("@vercel/request-context"), {
      get: () => ({ waitUntil: (promise: Promise<unknown>) => pending.push(promise) }),
    })
    try {
      await firstStore.withLock(randomUUID(), async (record) => {
        expect(await record.get()).toBeNull()
        expect(pending).toHaveLength(0)
        vi.useFakeTimers()
      })
      expect(pending).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(5_100)
      await Promise.all(pending)
    } finally {
      vi.useRealTimers()
      vi.unstubAllEnvs()
      vi.unstubAllGlobals()
    }
  })

  it("persists a pre-request phase even when the request callback throws", async () => {
    const fixture = checkoutFixture()
    await expect(
      firstStore.withLock(fixture.order.requestId, async (record) => {
        await record.insert(fixture.order)
        await record.update({ sessionId: fixture.sessionId, state: "creating" })
        throw new Error("process failed after durable claim")
      })
    ).rejects.toThrow("process failed")
    expect(await secondStore.findBySession(fixture.sessionId)).toMatchObject({ state: "creating" })
  })

  it("captures the paid shipping address durably once without changing the cart snapshot", async () => {
    const fixture = checkoutFixture()
    const address = fixture.order.shippingAddress!
    const order: CheckoutOrder = { ...fixture.order, shippingMode: "flat_rate" }
    delete order.shippingAddress
    await expect(
      firstStore.withLock(order.requestId, async (record) => {
        await record.insert(order)
        await record.update({ sessionId: `${fixture.sessionId}address` })
        await record.saveShippingAddress(address)
        throw new Error("process ended before fulfillment")
      })
    ).rejects.toThrow("process ended before fulfillment")
    expect((await secondStore.findBySession(`${fixture.sessionId}address`))?.order).toEqual({
      ...order,
      shippingAddress: address,
    })
    await secondStore.withLock(order.requestId, async (record) => {
      await record.saveShippingAddress(address)
      await expect(record.saveShippingAddress({ ...address, zip: "90210" })).rejects.toMatchObject({
        code: "SHIPPING_ADDRESS_CONFLICT",
      })
    })
    expect((await firstStore.findBySession(`${fixture.sessionId}address`))?.order.shippingAddress).toEqual(address)
  })

  it("persists the first verified capture across a crash and preserves it on repeated payment events", async () => {
    const fixture = checkoutFixture()
    const payment = paymentFixture()
    await expect(
      firstStore.withLock(fixture.order.requestId, async (record) => {
        await record.insert(fixture.order)
        await record.update({ sessionId: `${fixture.sessionId}payment` })
        expect((await record.get())?.payment).toBeNull()
        await record.savePayment(payment)
        throw new Error("process ended before fulfillment")
      })
    ).rejects.toThrow("process ended before fulfillment")
    await secondStore.withLock(fixture.order.requestId, async (record) => {
      expect((await record.get())?.payment).toEqual(payment)
      await record.savePayment(payment)
      await record.savePayment({ ...payment, customerName: "Changed name", customerEmail: null })
      await expect(record.savePayment({ ...payment, totalAmount: 4000, taxAmount: 501 })).rejects.toMatchObject({
        code: "PAYMENT_CAPTURE_CONFLICT",
      })
    })
    expect((await firstStore.findBySession(`${fixture.sessionId}payment`))?.payment).toEqual(payment)
  })

  it.each([
    {},
    { status: "paid", currency: "usd" },
    { ...paymentFixture(), taxAmount: -1 },
    { ...paymentFixture(), totalAmount: 1 },
    { ...paymentFixture(), livemode: "false" },
    { ...paymentFixture(), paymentIntentId: "https://example.com" },
    { ...paymentFixture(), paidAt: "yesterday" },
    { ...paymentFixture(), customerEmail: "a".repeat(321) },
  ])("rejects incomplete or inconsistent payment capture data: %j", async (payment) => {
    const fixture = checkoutFixture()
    await firstStore.withLock(fixture.order.requestId, (record) => record.insert(fixture.order))
    await expect(
      pool.query("update commerce.checkout_orders set payment = $2::jsonb where request_id = $1", [
        fixture.order.requestId,
        JSON.stringify(payment),
      ])
    ).rejects.toMatchObject({ code: "23514" })
  })

  it("never overwrites captured delivery details or captures a missing address after creation begins", async () => {
    const fixture = checkoutFixture()
    const address = fixture.order.shippingAddress!
    await firstStore.withLock(fixture.order.requestId, async (record) => {
      await record.insert(fixture.order)
      await expect(record.saveShippingAddress({ ...address, zip: "90210" })).rejects.toMatchObject({
        code: "SHIPPING_ADDRESS_CONFLICT",
      })
    })
    const incomplete: CheckoutOrder = { ...fixture.order, requestId: randomUUID(), shippingMode: "flat_rate" }
    delete incomplete.shippingAddress
    await firstStore.withLock(incomplete.requestId, async (record) => {
      await record.insert(incomplete)
      await record.update({ state: "creating" })
      await expect(record.saveShippingAddress(address)).rejects.toMatchObject({ code: "SHIPPING_ADDRESS_CONFLICT" })
    })
  })

  it("serializes concurrent paid events from independent connections and submits only once", async () => {
    const fixture = checkoutFixture()
    fixture.sessionId += "concurrent"
    fixture.session.id = fixture.sessionId
    fixture.providerOrder.metadata.shop_order_id = fixture.sessionId
    await firstStore.withLock(fixture.order.requestId, async (record) => {
      await record.insert(fixture.order)
      await record.update({ sessionId: fixture.sessionId })
    })
    vi.mocked(readCheckoutProduct).mockResolvedValue({
      id: fixture.productId,
      title: "Toast",
      variants: [{ id: 101, unitAmount: 3000, available: true, label: "M", fingerprint: `v2:${"a".repeat(64)}` }],
    })
    let release!: () => void
    let started!: () => void
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    const entered = new Promise<void>((resolve) => {
      started = resolve
    })
    const request = vi
      .spyOn(fixture.printify, "request")
      .mockImplementationOnce(async () => {
        started()
        await waiting
        return { id: "printify-concurrent" }
      })
      .mockResolvedValueOnce({ ...fixture.providerOrder, id: "printify-concurrent" })
      .mockResolvedValueOnce(null)
    const first = fulfillCheckout({ ...fixture.services, store: firstStore }, fixture.sessionId)
    await entered
    await expect(fulfillCheckout({ ...fixture.services, store: secondStore }, fixture.sessionId)).rejects.toMatchObject(
      { code: "ORDER_BUSY" }
    )
    release()
    expect(await first).toBe("submitted")
    expect(await fulfillCheckout({ ...fixture.services, store: secondStore }, fixture.sessionId)).toBe("submitted")
    expect(request.mock.calls.filter(([path, body]) => path === "orders.json" && body)).toHaveLength(1)
    expect(request.mock.calls.filter(([path]) => path.endsWith("send_to_production.json"))).toHaveLength(1)
  })

  it("keeps private order data behind RLS and outside public schema privileges", async () => {
    const result = await pool.query<{ relrowsecurity: boolean; public_usage: boolean }>(
      "select c.relrowsecurity, has_schema_privilege('public', n.oid, 'usage') as public_usage from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'commerce' and c.relname = 'checkout_orders'"
    )
    expect(result.rows[0]).toEqual({ relrowsecurity: true, public_usage: false })
  })
})

function paymentFixture(): CheckoutPayment {
  return {
    status: "paid",
    paymentIntentId: "pi_fixture",
    paidAt: "2026-09-21T14:00:00.000Z",
    livemode: true,
    currency: "usd",
    subtotalAmount: 3000,
    shippingAmount: 499,
    taxAmount: 280,
    totalAmount: 3779,
    customerName: "Robin Sample",
    customerEmail: "robin@example.com",
  }
}

function checkoutFixture() {
  const requestId = randomUUID()
  const sessionId = "cs_test_fixture12345678901234567890"
  const productId = "111111000000000000000002"
  const order: CheckoutOrder = {
    requestId,
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
  const store: OrderStore = {
    withLock: async (_id, callback) =>
      callback({
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
    metadata: { storefront: "fixture-store", checkout_request_id: requestId, shop_id: "1234" },
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
