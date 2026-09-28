import "server-only"

import type Stripe from "stripe"

import { CheckoutError } from "./checkout-error"
import type { OrderStore, StoredOrder } from "./checkout-order"
import type { PostgresCheckoutCapacity } from "./postgres-checkout-capacity.server"

type PaymentStatus = "paid" | "failed" | "expired" | "pending"
type Services = {
  stripe: Stripe
  store: Pick<OrderStore, "withLock">
  capacity: Pick<PostgresCheckoutCapacity, "reserveStripeRead">
  expectedLivemode: boolean
}

function savedPaymentStatus(order: StoredOrder): PaymentStatus | undefined {
  if (order.payment?.status === "paid" || order.state === "submitted" || order.state === "simulated") return "paid"
  if (order.failureCode === "PAYMENT_FAILED") return "failed"
  if (order.failureCode === "CHECKOUT_EXPIRED") return "expired"
}

export async function readCheckoutPaymentStatus(services: Services, order: StoredOrder) {
  const saved = savedPaymentStatus(order)
  if (saved) return { order, session: null, paymentStatus: saved }
  const sessionId = order.sessionId
  if (!sessionId) throw new CheckoutError("ORDER_MISSING", "We could not locate this checkout.", 404)
  try {
    await services.capacity.reserveStripeRead(sessionId, "status")
  } catch (error) {
    // Keep confirmation polling alive during a shared-budget pause without claiming an unverified payment.
    if (error instanceof CheckoutError && error.code === "CHECKOUT_RATE_LIMITED")
      return { order, session: null, paymentStatus: "pending" as const }
    throw error
  }
  const session = await services.stripe.checkout.sessions.retrieve(sessionId)
  const snapshot = order.order
  if (
    session.id !== sessionId ||
    session.mode !== "payment" ||
    session.livemode !== services.expectedLivemode ||
    !snapshot.commerceIdentity ||
    session.metadata?.storefront !== snapshot.commerceIdentity ||
    session.metadata.shop_id !== snapshot.shopId ||
    session.metadata.checkout_request_id !== snapshot.requestId ||
    session.client_reference_id !== snapshot.requestId
  )
    throw new CheckoutError("PAYMENT_MISMATCH", "Your payment needs our attention before we can confirm it.")

  if (session.status === "expired" && session.payment_status !== "paid") {
    // Expiration is authoritative only after Stripe reports it, never from our local expiry clock.
    // Recheck under the order lock so a concurrent verified capture cannot be overwritten.
    order = await services.store.withLock(snapshot.requestId, async (record) => {
      const current = await record.get()
      if (!current || current.sessionId !== sessionId)
        throw new CheckoutError("ORDER_MISSING", "We could not locate this checkout.", 404)
      if (savedPaymentStatus(current) || current.state !== "pending" || current.failureCode) return current
      await record.update({ failureCode: "CHECKOUT_EXPIRED" })
      return { ...current, failureCode: "CHECKOUT_EXPIRED" }
    })
  }
  return {
    order,
    session,
    paymentStatus:
      savedPaymentStatus(order) ??
      (session.payment_status === "paid" ? "paid" : session.status === "expired" ? "expired" : "pending"),
  }
}
