import { storeConfig } from "@/lib/store-config"
import type Stripe from "stripe"

import { CheckoutError } from "@/features/checkout/checkout-error"
import { fulfillCheckout } from "@/features/checkout/fulfill-checkout.server"
import { getCommerceServices } from "@/features/checkout/get-commerce-services.server"
import { readCheckoutBody } from "@/features/checkout/read-checkout-body.server"

export const runtime = "nodejs"
export const maxDuration = 60

export async function POST(request: Request) {
  let services: ReturnType<typeof getCommerceServices>
  try {
    services = getCommerceServices()
  } catch {
    return Response.json({ error: "Webhook not configured" }, { status: 503 })
  }
  let event: Stripe.Event
  try {
    const signature = request.headers.get("stripe-signature")
    if (!signature) return Response.json({ error: "Missing signature" }, { status: 400 })
    const raw = await readCheckoutBody(request, 1_048_576)
    event = services.stripe.webhooks.constructEvent(raw, signature, services.webhookSecret)
  } catch {
    return Response.json({ error: "Invalid signature or payload" }, { status: 400 })
  }
  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      await fulfillCheckout(services, event.data.object.id)
    } else if (event.type === "checkout.session.async_payment_failed") {
      const session = await services.stripe.checkout.sessions.retrieve(event.data.object.id)
      if (session.metadata?.storefront === storeConfig.id && session.payment_status !== "paid") {
        const order = await services.store.findBySession(session.id)
        if (order)
          await services.store.withLock(order.order.requestId, async (record) => {
            const latest = await record.get()
            if (latest?.state === "pending") await record.update({ failureCode: "PAYMENT_FAILED" })
          })
      }
    }
    return Response.json({ received: true })
  } catch (error) {
    console.error("Checkout fulfillment needs retry", {
      eventId: event.id,
      code: error instanceof CheckoutError ? error.code : "FULFILLMENT_UNAVAILABLE",
    })
    return Response.json({ error: "Fulfillment not complete; retry required" }, { status: 500 })
  }
}
