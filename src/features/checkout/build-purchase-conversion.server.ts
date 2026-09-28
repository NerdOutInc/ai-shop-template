import "server-only"

import { createHash } from "node:crypto"
import type Stripe from "stripe"

import type { PurchaseConversion } from "@/features/analytics/purchase-conversion"

import type { StoredOrder } from "./checkout-order"

function isAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

export function buildPurchaseConversion(
  session: Stripe.Checkout.Session,
  stored: StoredOrder,
  expectedLivemode: boolean
): PurchaseConversion | null {
  const { order } = stored
  const details = session.total_details
  const tax = details?.amount_tax
  if (
    !expectedLivemode ||
    session.livemode !== true ||
    stored.state === "simulated" ||
    stored.failureCode === "PAYMENT_REVERSED" ||
    session.mode !== "payment" ||
    session.status !== "complete" ||
    session.payment_status !== "paid" ||
    !session.id ||
    session.id !== stored.sessionId ||
    !order.commerceIdentity ||
    session.metadata?.storefront !== order.commerceIdentity ||
    session.metadata.shop_id !== order.shopId ||
    session.metadata.checkout_request_id !== order.requestId ||
    session.client_reference_id !== order.requestId ||
    order.currency !== "usd" ||
    session.currency !== order.currency ||
    order.shippingMode !== "flat_rate" ||
    !isAmount(order.subtotal) ||
    !isAmount(order.shippingAmount) ||
    !isAmount(session.amount_subtotal) ||
    !isAmount(session.amount_total) ||
    !isAmount(tax) ||
    details?.amount_discount !== 0 ||
    details.amount_shipping !== order.shippingAmount ||
    session.amount_subtotal !== order.subtotal ||
    session.amount_total !== order.subtotal + order.shippingAmount + tax
  )
    return null

  return {
    // This marker stays in browser storage; analytics receives only the aggregate purchase properties.
    receipt: createHash("sha256").update(session.id).digest("hex"),
    totalUsd: session.amount_total / 100,
  }
}
