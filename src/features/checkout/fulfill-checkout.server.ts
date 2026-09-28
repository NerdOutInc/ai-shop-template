import { storeConfig } from "@/lib/store-config"
import "server-only"

import type Stripe from "stripe"
import { z } from "zod"

import { CheckoutError } from "./checkout-error"
import type { CheckoutOrder, OrderStore } from "./checkout-order"
import { matchesProductFingerprint } from "./matches-product-fingerprint"
import type { PrintifyClient } from "./printify-client.server"
import { readCheckoutProduct } from "./read-checkout-product.server"
import { readPrintifyOrder } from "./read-printify-order.server"
import { readStripeShippingAddress } from "./read-stripe-shipping-address.server"
import { toPrintifyAddress } from "./to-printify-address"
import { verifyPaidSession } from "./verify-paid-session.server"

type Services = { stripe: Stripe; store: OrderStore; printify: PrintifyClient; liveFulfillment: boolean }

async function verifyProducts(services: Services, order: CheckoutOrder) {
  if (!services.liveFulfillment)
    throw new CheckoutError("FULFILLMENT_DISABLED", "Your paid order is waiting for the shop to enable fulfillment.")
  const ids = [...new Set(order.items.map((item) => item.productId))]
  const products = await Promise.all(ids.map((id) => readCheckoutProduct(services.printify, id)))
  for (const item of order.items) {
    const variant = products
      .find((product) => product.id === item.productId)
      ?.variants.find((variant) => variant.id === item.variantId)
    if (!variant?.available || !matchesProductFingerprint(variant, item.productFingerprint)) {
      throw new CheckoutError("PRODUCT_CHANGED", "Your selected shirt needs our attention before it can be printed.")
    }
  }
}

export async function fulfillCheckout(services: Services, sessionId: string) {
  const session = await services.stripe.checkout.sessions.retrieve(sessionId)
  if (session.metadata?.storefront !== storeConfig.id) return "ignored"
  if (session.payment_status !== "paid") return "unpaid"
  const requestId = z.uuid().safeParse(session.metadata.checkout_request_id)
  if (!requestId.success) throw new CheckoutError("ORDER_MISSING", "Your paid order needs our attention.")
  return services.store.withLock(requestId.data, async (record) => {
    const stored = await record.get()
    if (!stored || stored.sessionId !== session.id || stored.order.shopId !== services.printify.shopId) {
      throw new CheckoutError("ORDER_MISSING", "Your paid order needs our attention.")
    }
    if (stored.state === "submitted" || stored.state === "simulated") return stored.state
    try {
      const payment = await verifyPaidSession(services.stripe, session, stored.order)
      try {
        await record.savePayment(payment)
      } catch (error) {
        if (error instanceof CheckoutError) throw error
        throw new CheckoutError("PAYMENT_CAPTURE_UNAVAILABLE", "Your paid order needs our attention before printing.")
      }
      let order = stored.order
      {
        const shippingAddress = readStripeShippingAddress(session)
        if (!order.shippingAddress) {
          await record.saveShippingAddress(shippingAddress)
          order = { ...order, shippingAddress }
        } else if (
          Object.entries(shippingAddress).some(
            ([field, value]) => order.shippingAddress?.[field as keyof typeof shippingAddress] !== value
          )
        ) {
          throw new CheckoutError(
            "SHIPPING_ADDRESS_CONFLICT",
            "Your delivery details changed after payment and need our attention before printing."
          )
        }
      }
      if (!order.shippingAddress) {
        throw new CheckoutError("SHIPPING_ADDRESS_INVALID", "Your delivery details need our attention before printing.")
      }
      if (!session.livemode) {
        await record.update({ state: "simulated", failureCode: null })
        return "simulated"
      }
      let orderId = stored.printifyOrderId
      if (stored.state === "pending") {
        await verifyProducts(services, order)
        await record.update({ state: "creating", failureCode: null })
        const response = z.object({ id: z.string().min(1) }).safeParse(
          await services.printify.request("orders.json", {
            external_id: session.id,
            label: `ORDER-${order.requestId.slice(0, 8).toUpperCase()}`,
            line_items: order.items.map((item, index) => ({
              product_id: item.productId,
              variant_id: item.variantId,
              quantity: item.quantity,
              external_id: `${session.id}-${index}`,
            })),
            shipping_method: 1,
            send_shipping_notification: true,
            address_to: toPrintifyAddress(order.shippingAddress),
          })
        )
        if (!response.success) throw new CheckoutError("ORDER_CREATE_UNCERTAIN", "Your order needs our attention.")
        orderId = response.data.id
        await record.update({ state: "created", printifyOrderId: orderId })
      }
      const printifyOrder = await readPrintifyOrder(services.printify, session.id, order, orderId ?? undefined)
      if (!printifyOrder)
        throw new CheckoutError("ORDER_CREATE_UNCERTAIN", "Your payment is safe, but your order needs our attention.")
      if (!orderId) {
        orderId = printifyOrder.id
        await record.update({ state: "created", printifyOrderId: orderId })
      }
      if (
        ["sending-to-production", "in-production", "fulfilled", "partially-fulfilled"].includes(printifyOrder.status)
      ) {
        await record.update({ state: "submitted", failureCode: null })
        return "submitted"
      }
      if (stored.state === "submitting")
        throw new CheckoutError("PRODUCTION_UNCERTAIN", "Your print submission needs our attention.")
      if (["pending", "cost-calculation"].includes(printifyOrder.status)) {
        throw new CheckoutError("PROVIDER_PROCESSING", "Your paid order is being prepared by our print partner.")
      }
      if (
        printifyOrder.status !== "on-hold" ||
        printifyOrder.line_items.some((item) => item.status && !["pending", "on-hold"].includes(item.status))
      ) {
        throw new CheckoutError("PROVIDER_ORDER_ISSUE", "Your print submission needs our attention.")
      }
      await verifyProducts(services, order)
      await record.update({ state: "submitting", failureCode: null })
      await services.printify.request(`orders/${encodeURIComponent(orderId)}/send_to_production.json`, {})
      await record.update({ state: "submitted", failureCode: null })
      return "submitted"
    } catch (error) {
      await record.update({ failureCode: error instanceof CheckoutError ? error.code : "FULFILLMENT_UNAVAILABLE" })
      throw error
    }
  })
}
