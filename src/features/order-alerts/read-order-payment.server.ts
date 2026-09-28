import { storeConfig } from "@/lib/store-config"
import "server-only"

import type Stripe from "stripe"
import type { AlertOrder, PaymentCheck } from "./order-alert"

export async function readOrderPayment(stripe: Stripe, order: AlertOrder): Promise<PaymentCheck> {
  try {
    const intent = await stripe.paymentIntents.retrieve(
      order.payment.paymentIntentId,
      { expand: ["latest_charge"] },
      { maxNetworkRetries: 0, timeout: 15_000 }
    )
    const charge = intent.latest_charge
    if (
      intent.id !== order.payment.paymentIntentId ||
      !intent.livemode ||
      intent.status !== "succeeded" ||
      intent.currency !== "usd" ||
      intent.amount_received !== order.payment.totalAmount ||
      intent.metadata.storefront !== storeConfig.id ||
      intent.metadata.checkout_request_id !== order.request_id ||
      !charge ||
      typeof charge === "string" ||
      !charge.paid ||
      !charge.livemode ||
      charge.currency !== "usd" ||
      charge.amount !== order.payment.totalAmount
    )
      return "unknown"
    if (charge.refunded && charge.amount_refunded === charge.amount) return "refunded"
    if (charge.disputed) return "disputed"
    if (charge.amount_refunded > 0) return "partial_refund"
    return "paid"
  } catch {
    return "unknown"
  }
}
