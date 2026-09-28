import "server-only"

import type Stripe from "stripe"

import { CheckoutError } from "./checkout-error"
import type { CheckoutOrder, CheckoutPayment } from "./checkout-order"

function customerText(value: string | null | undefined, limit: number) {
  const text = value?.trim()
  return text && text.length <= limit && !/[\u0000-\u001f\u007f]/.test(text) ? text : null
}

export async function verifyPaidSession(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  order: CheckoutOrder
): Promise<CheckoutPayment> {
  const mismatch = () =>
    new CheckoutError("PAYMENT_MISMATCH", "Your payment needs our attention before we can print your order.")
  const tax = session.total_details?.amount_tax
  if (
    order.shippingMode !== "flat_rate" ||
    session.mode !== "payment" ||
    session.status !== "complete" ||
    session.payment_status !== "paid" ||
    !order.commerceIdentity ||
    session.metadata?.storefront !== order.commerceIdentity ||
    session.metadata.checkout_request_id !== order.requestId ||
    session.metadata.shop_id !== order.shopId ||
    session.client_reference_id !== order.requestId ||
    session.currency !== order.currency ||
    session.amount_subtotal !== order.subtotal ||
    session.total_details?.amount_shipping !== order.shippingAmount ||
    session.total_details.amount_discount !== 0 ||
    tax === undefined ||
    !Number.isSafeInteger(tax) ||
    tax < 0 ||
    session.amount_total !== order.subtotal + order.shippingAmount + tax
  )
    throw mismatch()
  {
    const shipping = session.shipping_cost
    if (
      !shipping?.shipping_rate ||
      shipping.amount_subtotal !== order.shippingAmount ||
      !Number.isSafeInteger(shipping.amount_tax) ||
      shipping.amount_tax < 0 ||
      shipping.amount_tax > tax ||
      shipping.amount_total !== order.shippingAmount + shipping.amount_tax
    )
      throw mismatch()
    const rate =
      typeof shipping.shipping_rate === "string"
        ? await stripe.shippingRates.retrieve(shipping.shipping_rate)
        : shipping.shipping_rate
    if (
      rate.type !== "fixed_amount" ||
      rate.fixed_amount?.amount !== order.shippingAmount ||
      rate.fixed_amount.currency !== order.currency ||
      rate.tax_behavior !== "exclusive" ||
      rate.metadata.kind !== "shipping" ||
      rate.metadata.checkout_request_id !== order.requestId ||
      (typeof shipping.shipping_rate === "string" && rate.id !== shipping.shipping_rate)
    )
      throw mismatch()
  }
  const lines = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100, expand: ["data.price.product"] })
  if (lines.has_more || lines.data.length !== order.items.length) throw mismatch()
  const unmatched = [...order.items]
  for (const line of lines.data) {
    const product = line.price?.product
    if (!product || typeof product === "string" || "deleted" in product) throw mismatch()
    const index = unmatched.findIndex(
      (item) => item.productId === product.metadata.product_id && String(item.variantId) === product.metadata.variant_id
    )
    const item = unmatched[index]
    if (
      !item ||
      line.quantity !== item.quantity ||
      line.price?.unit_amount !== item.unitAmount ||
      line.currency !== "usd" ||
      line.amount_subtotal !== item.quantity * item.unitAmount
    )
      throw mismatch()
    unmatched.splice(index, 1)
  }
  if (unmatched.length) throw mismatch()
  const intentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id
  if (!intentId || !/^pi_[a-zA-Z0-9]+$/.test(intentId)) throw mismatch()
  const intent = await stripe.paymentIntents.retrieve(intentId, { expand: ["latest_charge"] })
  const charge = intent.latest_charge
  if (
    intent.id !== intentId ||
    intent.livemode !== session.livemode ||
    (charge &&
      typeof charge !== "string" &&
      (charge.livemode !== session.livemode ||
        (typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id) !== intentId))
  )
    throw mismatch()
  if (
    intent.status !== "succeeded" ||
    intent.amount_received !== session.amount_total ||
    intent.currency !== "usd" ||
    !charge ||
    typeof charge === "string" ||
    charge.amount !== session.amount_total ||
    charge.amount_captured !== session.amount_total ||
    charge.currency !== order.currency ||
    !charge.captured ||
    !charge.paid ||
    charge.refunded ||
    charge.amount_refunded > 0 ||
    charge.disputed
  ) {
    throw new CheckoutError("PAYMENT_REVERSED", "Your payment needs our attention before we can print your order.")
  }
  if (!Number.isSafeInteger(charge.created) || charge.created <= 0 || charge.created > 253402300799) throw mismatch()
  return {
    status: "paid",
    paymentIntentId: intentId,
    paidAt: new Date(charge.created * 1000).toISOString(),
    livemode: session.livemode,
    currency: "usd",
    subtotalAmount: order.subtotal,
    shippingAmount: order.shippingAmount,
    taxAmount: tax,
    totalAmount: session.amount_total,
    // Billing customer; the delivery recipient is captured separately in the order's shipping address.
    customerName: customerText(session.customer_details?.name, 200),
    customerEmail: customerText(session.customer_details?.email, 320),
  }
}
