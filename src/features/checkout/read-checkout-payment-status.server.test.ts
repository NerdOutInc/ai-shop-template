// @vitest-environment node

import type Stripe from "stripe"
import { describe, expect, it, vi } from "vitest"

import { orderAlertFixture } from "../../../test/order-alert-fixture"

import { CheckoutError } from "./checkout-error"
import type { OrderStore, StoredOrder } from "./checkout-order"
import { readCheckoutPaymentStatus } from "./read-checkout-payment-status.server"

vi.mock("server-only", () => ({}))

type OrderRecord = Parameters<Parameters<OrderStore["withLock"]>[1]>[0]

function fixture() {
  const alert = orderAlertFixture()
  const order: StoredOrder = {
    order: alert.snapshot,
    payment: null,
    sessionId: alert.session_id,
    checkoutUrl: "https://checkout.stripe.com/c/pay/fixture",
    state: "pending",
    printifyOrderId: null,
    failureCode: null,
  }
  const session = {
    id: order.sessionId,
    mode: "payment",
    livemode: true,
    status: "open",
    payment_status: "unpaid",
    client_reference_id: order.order.requestId,
    metadata: {
      storefront: order.order.commerceIdentity,
      shop_id: order.order.shopId,
      checkout_request_id: order.order.requestId,
    },
  } as unknown as Stripe.Checkout.Session
  let current: StoredOrder | null = order
  const get = vi.fn(async () => current)
  const update = vi.fn<OrderRecord["update"]>(async (patch) => {
    if (!current) throw new Error("The order must exist before updating it")
    current = { ...current, ...patch }
  })
  const unexpectedWrite = vi.fn(async () => {
    throw new Error("Reading payment status must not change payment, identity, address, or checkout data")
  })
  const record: OrderRecord = {
    get,
    update,
    ensureCommerceIdentity: unexpectedWrite,
    insert: unexpectedWrite,
    savePayment: unexpectedWrite,
    saveShippingAddress: unexpectedWrite,
  }
  let lock = Promise.resolve()
  const store: Pick<OrderStore, "withLock"> = {
    withLock: (...[, callback]) => {
      const result = lock.then(() => callback(record))
      lock = result.then(
        () => undefined,
        () => undefined
      )
      return result
    },
  }
  const withLock = vi.spyOn(store, "withLock")
  const reserveStripeRead = vi.fn(async () => undefined)
  const retrieve = vi.fn(async () => session)
  const services = {
    stripe: { checkout: { sessions: { retrieve } } } as unknown as Stripe,
    store,
    capacity: { reserveStripeRead },
    expectedLivemode: true,
  }
  return {
    order,
    session,
    payment: alert.payment!,
    services,
    retrieve,
    reserveStripeRead,
    withLock,
    get,
    update,
    getCurrent: () => current,
    setCurrent: (value: StoredOrder | null) => {
      current = value
    },
  }
}

describe("readCheckoutPaymentStatus", () => {
  it.each(["pending", "creating", "created", "submitting", "submitted", "simulated"] as const)(
    "returns the verified capture in %s without depending on Stripe or its budget",
    async (state) => {
      const f = fixture()
      f.order.state = state
      f.order.payment = f.payment
      f.order.failureCode = "PRINTIFY_UNAVAILABLE"
      f.reserveStripeRead.mockRejectedValue(new Error("Budget exhausted"))
      f.retrieve.mockRejectedValue(new Error("Stripe unavailable"))
      const before = structuredClone(f.order)

      await expect(readCheckoutPaymentStatus(f.services, f.order)).resolves.toEqual({
        order: before,
        session: null,
        paymentStatus: "paid",
      })

      expect(f.reserveStripeRead).not.toHaveBeenCalled()
      expect(f.retrieve).not.toHaveBeenCalled()
      expect(f.withLock).not.toHaveBeenCalled()
      expect(f.getCurrent()).toEqual(before)
    }
  )

  it.each(["submitted", "simulated"] as const)(
    "acknowledges completed %s fulfillment without a Stripe refresh or payment rewrite",
    async (state) => {
      const f = fixture()
      f.order.state = state
      f.order.printifyOrderId = state === "submitted" ? "printify-fixture" : null
      const before = structuredClone(f.order)

      await expect(readCheckoutPaymentStatus(f.services, f.order)).resolves.toEqual({
        order: before,
        session: null,
        paymentStatus: "paid",
      })

      expect(f.reserveStripeRead).not.toHaveBeenCalled()
      expect(f.retrieve).not.toHaveBeenCalled()
      expect(f.withLock).not.toHaveBeenCalled()
      expect(f.getCurrent()).toEqual(before)
    }
  )

  it.each([
    ["PAYMENT_FAILED", "failed"],
    ["CHECKOUT_EXPIRED", "expired"],
  ] as const)("returns saved %s without spending another Stripe read", async (failureCode, paymentStatus) => {
    const f = fixture()
    f.order.failureCode = failureCode

    await expect(readCheckoutPaymentStatus(f.services, f.order)).resolves.toEqual({
      order: f.order,
      session: null,
      paymentStatus,
    })

    expect(f.reserveStripeRead).not.toHaveBeenCalled()
    expect(f.retrieve).not.toHaveBeenCalled()
    expect(f.withLock).not.toHaveBeenCalled()
  })

  it.each(["open", "complete"] as const)(
    "keeps an unpaid %s session pending after the local expiry time, including delayed payments",
    async (status) => {
      const f = fixture()
      f.session.status = status
      expect(f.order.order.expiresAt).toBeLessThan(Date.now() / 1000)

      await expect(readCheckoutPaymentStatus(f.services, f.order)).resolves.toEqual({
        order: f.order,
        session: f.session,
        paymentStatus: "pending",
      })

      expect(f.reserveStripeRead).toHaveBeenCalledExactlyOnceWith(f.order.sessionId, "status")
      expect(f.retrieve).toHaveBeenCalledExactlyOnceWith(f.order.sessionId)
      expect(f.reserveStripeRead.mock.invocationCallOrder[0]!).toBeLessThan(f.retrieve.mock.invocationCallOrder[0]!)
      expect(f.withLock).not.toHaveBeenCalled()
      expect(f.getCurrent()?.failureCode).toBeNull()
    }
  )

  it("persists Stripe expiration once under the order lock and serves later polls from saved state", async () => {
    const f = fixture()
    f.session.status = "expired"

    const results = await Promise.all([
      readCheckoutPaymentStatus(f.services, f.order),
      readCheckoutPaymentStatus(f.services, f.order),
    ])

    for (const result of results) {
      expect(result.paymentStatus).toBe("expired")
      expect(result.order.failureCode).toBe("CHECKOUT_EXPIRED")
    }
    expect(f.withLock).toHaveBeenCalledTimes(2)
    expect(f.withLock.mock.calls.map(([requestId]) => requestId)).toEqual([
      f.order.order.requestId,
      f.order.order.requestId,
    ])
    expect(f.get).toHaveBeenCalledTimes(2)
    expect(f.update).toHaveBeenCalledExactlyOnceWith({ failureCode: "CHECKOUT_EXPIRED" })
    expect(f.get.mock.invocationCallOrder[0]!).toBeLessThan(f.update.mock.invocationCallOrder[0]!)
    expect(f.getCurrent()).toEqual({ ...f.order, failureCode: "CHECKOUT_EXPIRED" })

    const saved = await readCheckoutPaymentStatus(f.services, f.getCurrent()!)
    expect(saved).toEqual({ order: f.getCurrent(), session: null, paymentStatus: "expired" })
    expect(f.reserveStripeRead).toHaveBeenCalledTimes(2)
    expect(f.retrieve).toHaveBeenCalledTimes(2)
    expect(f.withLock).toHaveBeenCalledTimes(2)
    expect(f.update).toHaveBeenCalledTimes(1)
  })

  it.each([
    { label: "verified capture", state: "pending", paid: true, failureCode: null, paymentStatus: "paid" },
    { label: "submitted fulfillment", state: "submitted", paid: false, failureCode: null, paymentStatus: "paid" },
    { label: "simulated fulfillment", state: "simulated", paid: false, failureCode: null, paymentStatus: "paid" },
    { label: "failed payment", state: "pending", paid: false, failureCode: "PAYMENT_FAILED", paymentStatus: "failed" },
  ] as const)("preserves a concurrent $label when Stripe reports expiration", async (change) => {
    const f = fixture()
    f.session.status = "expired"
    const concurrent: StoredOrder = {
      ...f.order,
      state: change.state,
      payment: change.paid ? f.payment : null,
      failureCode: change.failureCode,
      printifyOrderId: change.state === "submitted" ? "printify-concurrent" : null,
    }
    f.retrieve.mockImplementationOnce(async () => {
      f.setCurrent(concurrent)
      return f.session
    })

    await expect(readCheckoutPaymentStatus(f.services, f.order)).resolves.toEqual({
      order: concurrent,
      session: f.session,
      paymentStatus: change.paymentStatus,
    })

    expect(f.withLock).toHaveBeenCalledExactlyOnceWith(f.order.order.requestId, expect.any(Function))
    expect(f.get).toHaveBeenCalledOnce()
    expect(f.update).not.toHaveBeenCalled()
    expect(f.getCurrent()).toBe(concurrent)
  })

  it.each(["creating", "created", "submitting"] as const)(
    "does not replace a concurrent %s fulfillment claim with checkout expiration",
    async (state) => {
      const f = fixture()
      f.session.status = "expired"
      const concurrent = { ...f.order, state, printifyOrderId: "printify-concurrent" }
      f.retrieve.mockImplementationOnce(async () => {
        f.setCurrent(concurrent)
        return f.session
      })

      const result = await readCheckoutPaymentStatus(f.services, f.order)

      expect(result.order).toBe(concurrent)
      expect(f.withLock).toHaveBeenCalledOnce()
      expect(f.update).not.toHaveBeenCalled()
      expect(f.getCurrent()).toBe(concurrent)
    }
  )

  it("preserves an existing fulfillment failure instead of overwriting it with expiration", async () => {
    const f = fixture()
    f.order.failureCode = "SHIPPING_ADDRESS_INVALID"
    f.session.status = "expired"

    const result = await readCheckoutPaymentStatus(f.services, f.order)

    expect(result.order.failureCode).toBe("SHIPPING_ADDRESS_INVALID")
    expect(f.update).not.toHaveBeenCalled()
  })

  it("does not persist expiration for a session that Stripe reports as paid", async () => {
    const f = fixture()
    f.session.status = "expired"
    f.session.payment_status = "paid"

    const result = await readCheckoutPaymentStatus(f.services, f.order)

    expect(result.paymentStatus).toBe("paid")
    expect(f.withLock).not.toHaveBeenCalled()
    expect(f.getCurrent()?.failureCode).toBeNull()
    expect(f.getCurrent()?.payment).toBeNull()
  })

  it.each([
    "session",
    "mode",
    "livemode",
    "missing identity",
    "identity",
    "shop",
    "request",
    "client reference",
    "missing metadata",
  ] as const)("rejects a wrong %s binding before persisting Stripe expiration", async (mismatch) => {
    const f = fixture()
    f.session.status = "expired"
    switch (mismatch) {
      case "session":
        f.session.id = "cs_foreign"
        break
      case "mode":
        f.session.mode = "subscription"
        break
      case "livemode":
        f.session.livemode = false
        break
      case "missing identity":
        Reflect.deleteProperty(f.order.order, "commerceIdentity")
        break
      case "identity":
        f.session.metadata!.storefront = "foreign-store"
        break
      case "shop":
        f.session.metadata!.shop_id = "foreign-shop"
        break
      case "request":
        f.session.metadata!.checkout_request_id = "foreign-request"
        break
      case "client reference":
        f.session.client_reference_id = "foreign-request"
        break
      case "missing metadata":
        f.session.metadata = null
        break
    }
    const before = structuredClone(f.order)

    await expect(readCheckoutPaymentStatus(f.services, f.order)).rejects.toMatchObject({ code: "PAYMENT_MISMATCH" })

    expect(f.reserveStripeRead).toHaveBeenCalledExactlyOnceWith(f.order.sessionId, "status")
    expect(f.retrieve).toHaveBeenCalledExactlyOnceWith(f.order.sessionId)
    expect(f.withLock).not.toHaveBeenCalled()
    expect(f.update).not.toHaveBeenCalled()
    expect(f.getCurrent()).toEqual(before)
  })

  it.each(["missing", "different session"] as const)(
    "rejects an order that is %s when the expiration lock is acquired",
    async (change) => {
      const f = fixture()
      f.session.status = "expired"
      const concurrent = change === "missing" ? null : { ...f.order, sessionId: "cs_replaced" }
      f.retrieve.mockImplementationOnce(async () => {
        f.setCurrent(concurrent)
        return f.session
      })

      await expect(readCheckoutPaymentStatus(f.services, f.order)).rejects.toMatchObject({ code: "ORDER_MISSING" })

      expect(f.withLock).toHaveBeenCalledOnce()
      expect(f.update).not.toHaveBeenCalled()
      expect(f.getCurrent()).toBe(concurrent)
    }
  )

  it("rejects an order without a session before reserving a Stripe read", async () => {
    const f = fixture()
    f.order.sessionId = null

    await expect(readCheckoutPaymentStatus(f.services, f.order)).rejects.toMatchObject({ code: "ORDER_MISSING" })

    expect(f.reserveStripeRead).not.toHaveBeenCalled()
    expect(f.retrieve).not.toHaveBeenCalled()
    expect(f.withLock).not.toHaveBeenCalled()
  })

  it("keeps an unresolved order pending when its Stripe read quota is exhausted", async () => {
    const f = fixture()
    f.reserveStripeRead.mockRejectedValueOnce(
      new CheckoutError("CHECKOUT_RATE_LIMITED", "Please try again shortly.", 429)
    )
    const before = structuredClone(f.order)

    await expect(readCheckoutPaymentStatus(f.services, f.order)).resolves.toEqual({
      order: before,
      session: null,
      paymentStatus: "pending",
    })

    expect(f.reserveStripeRead).toHaveBeenCalledExactlyOnceWith(f.order.sessionId, "status")
    expect(f.retrieve).not.toHaveBeenCalled()
    expect(f.withLock).not.toHaveBeenCalled()
    expect(f.getCurrent()).toEqual(before)
  })

  it("does not call Stripe or suppress an unexpected reservation failure", async () => {
    const f = fixture()
    const failure = new Error("Budget exhausted")
    f.reserveStripeRead.mockRejectedValueOnce(failure)

    await expect(readCheckoutPaymentStatus(f.services, f.order)).rejects.toBe(failure)

    expect(f.reserveStripeRead).toHaveBeenCalledExactlyOnceWith(f.order.sessionId, "status")
    expect(f.retrieve).not.toHaveBeenCalled()
    expect(f.withLock).not.toHaveBeenCalled()
    expect(f.getCurrent()?.failureCode).toBeNull()
  })

  it("reserves the Stripe read even when retrieval fails and preserves the saved order", async () => {
    const f = fixture()
    const failure = new Error("Stripe unavailable")
    f.retrieve.mockRejectedValueOnce(failure)
    const before = structuredClone(f.order)

    await expect(readCheckoutPaymentStatus(f.services, f.order)).rejects.toBe(failure)

    expect(f.reserveStripeRead).toHaveBeenCalledExactlyOnceWith(f.order.sessionId, "status")
    expect(f.retrieve).toHaveBeenCalledExactlyOnceWith(f.order.sessionId)
    expect(f.withLock).not.toHaveBeenCalled()
    expect(f.getCurrent()).toEqual(before)
  })
})
