import "server-only"

import { createHash } from "node:crypto"

import type Stripe from "stripe"

import { deliveryEstimates } from "@/features/store-policies/delivery-estimates"
import { storeConfig } from "@/lib/store-config"

import { calculateCartShipping } from "./calculate-cart-shipping"
import { CheckoutError } from "./checkout-error"
import type { CheckoutOrder, OrderStore } from "./checkout-order"
import type { HostedCheckoutRequest } from "./hosted-checkout-request"
import { matchesProductFingerprint } from "./matches-product-fingerprint"
import type { PrintifyClient } from "./printify-client.server"
import { readCheckoutItems } from "./read-checkout-items.server"

type Services = {
  stripe: Stripe
  store: OrderStore
  printify: PrintifyClient
  siteUrl: string
  automaticTax: boolean
  liveFulfillment: boolean
  expectedLivemode: boolean
  capacity: {
    reserveProviderReads: (count: number) => Promise<void>
    reserveStripeRead: (sessionId: string) => Promise<void>
  }
}

type Request = HostedCheckoutRequest

async function quoteRequest(services: Services, request: Request) {
  const items = await readCheckoutItems(services.printify, request, (count) =>
    services.capacity.reserveProviderReads(count)
  )
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitAmount, 0)
  const shipping = calculateCartShipping(items)
  return { items, subtotal, shipping, total: subtotal + shipping, currency: "USD" as const }
}

export async function createCheckout(services: Services, request: Request) {
  if (!storeConfig.configured || !storeConfig.policies.published || !storeConfig.commerce.shippingConfirmed) {
    throw new CheckoutError("STORE_SETUP_REQUIRED", "Checkout will open when this store finishes setup.")
  }
  if (services.expectedLivemode && !services.liveFulfillment) {
    throw new CheckoutError("FULFILLMENT_DISABLED", "Checkout is unavailable while we finish connecting fulfillment.")
  }
  // Attribution is frozen with the first snapshot, but is not part of the cart's retry identity.
  // A new campaign or a privacy change must not strand an otherwise identical checkout.
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(request, (key, value: unknown) => (key === "attribution" ? undefined : value)))
    .digest("hex")
  return services.store.withLock(request.requestId, async (record) => {
    const existing = await record.get()
    if (existing && existing.order.requestFingerprint !== fingerprint) {
      throw new CheckoutError("REQUEST_CONFLICT", "Your bag has changed. Please request a fresh shipping quote.", 409)
    }
    if (existing && !existing.order.commerceIdentity) {
      throw new CheckoutError("ORDER_IDENTITY_MISSING", "This checkout needs our attention. Please contact the shop.")
    }
    if (existing?.sessionId && existing.checkoutUrl) {
      await services.capacity.reserveStripeRead(existing.sessionId)
      const session = await services.stripe.checkout.sessions.retrieve(existing.sessionId)
      if (session.status === "complete")
        return {
          url: `${services.siteUrl}/checkout/success?session_id=${encodeURIComponent(session.id)}`,
          sessionId: session.id,
        }
      if (
        session.status !== "open" ||
        existing.order.expiresAt <= Math.floor(Date.now() / 1000) ||
        session.expires_at <= Math.floor(Date.now() / 1000)
      ) {
        throw new CheckoutError("REQUEST_EXPIRED", "This checkout expired. Please request a fresh shipping quote.", 409)
      }
      if (session.livemode !== services.expectedLivemode || (session.livemode && !services.liveFulfillment)) {
        await services.stripe.checkout.sessions.expire(session.id)
        throw new CheckoutError(
          "CHECKOUT_MODE_MISMATCH",
          "Checkout is unavailable while we check the payment settings."
        )
      }
      return { url: existing.checkoutUrl, sessionId: existing.sessionId }
    }
    let order = existing?.order
    // Stripe requires at least 30 minutes until expiry when a new Session is first created.
    if (order && order.expiresAt <= Math.floor(Date.now() / 1000) + 1800) {
      throw new CheckoutError("REQUEST_EXPIRED", "This checkout expired. Please request a fresh shipping quote.", 409)
    }
    if (order) {
      const savedOrder = order
      // Shipping is part of the saved Stripe payload; a policy change must not rewrite an idempotent retry.
      const refreshed = await quoteRequest(services, request)
      if (
        refreshed.items.length !== savedOrder.items.length ||
        refreshed.items.some((item, index) => {
          const saved = savedOrder.items[index]
          if (!saved || saved.productId !== item.productId || saved.variantId !== item.variantId) return true
          return !matchesProductFingerprint({ fingerprint: item.productFingerprint }, saved.productFingerprint)
        })
      ) {
        throw new CheckoutError(
          "PRODUCT_CHANGED",
          "Your bag changed while checkout was opening. Please review a fresh shipping quote.",
          409
        )
      }
    }
    if (!order) {
      await record.ensureCommerceIdentity(storeConfig.commerce.identity)
      const quote = await quoteRequest(services, request)
      if (quote.shipping !== request.expectedShippingAmount)
        throw new CheckoutError(
          "SHIPPING_CHANGED",
          "The shipping price changed. Please review a fresh quote before paying.",
          409
        )
      order = {
        commerceIdentity: storeConfig.commerce.identity,
        requestId: request.requestId,
        requestFingerprint: fingerprint,
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        shopId: services.printify.shopId,
        items: quote.items,
        shippingMode: "flat_rate",
        shippingAmount: quote.shipping,
        subtotal: quote.subtotal,
        currency: "usd",
        shippingEstimate: {
          handlingBusinessDays: deliveryEstimates.handling.max,
          calendar: "us-federal-v1",
          timeZone: storeConfig.timeZone,
        },
        ...("attribution" in request && request.attribution ? { attribution: request.attribution } : {}),
      } satisfies CheckoutOrder
      await record.insert(order)
    }
    if (services.automaticTax) {
      const [settings, registrations] = await Promise.all([
        services.stripe.tax.settings.retrieve(),
        services.stripe.tax.registrations.list({ status: "active", limit: 1 }),
      ])
      if (settings.status !== "active" || !registrations.data.length) {
        throw new CheckoutError("TAX_NOT_CONFIGURED", "Checkout is unavailable while we finish the tax settings.")
      }
    }
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      client_reference_id: order.requestId,
      success_url: `${services.siteUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${services.siteUrl}/cart?checkout=cancelled`,
      expires_at: order.expiresAt,
      adaptive_pricing: { enabled: false },
      automatic_tax: { enabled: services.automaticTax },
      metadata: { storefront: order.commerceIdentity, checkout_request_id: order.requestId, shop_id: order.shopId },
      payment_intent_data: { metadata: { storefront: order.commerceIdentity, checkout_request_id: order.requestId } },
      line_items: order.items.map((item) => ({
        quantity: item.quantity,
        price_data: {
          currency: "usd",
          unit_amount: item.unitAmount,
          tax_behavior: "exclusive",
          product_data: {
            name: `${item.title} — ${item.variantLabel}`,
            ...(item.imageUrl ? { images: [item.imageUrl] } : {}),
            metadata: { product_id: item.productId, variant_id: String(item.variantId) },
          },
        },
      })),
    }
    params.shipping_address_collection = { allowed_countries: ["US"] }
    params.phone_number_collection = { enabled: true }
    params.custom_text = {
      shipping_address: { message: "We ship to the 50 US states and Washington, DC." },
    }
    params.shipping_options = [
      {
        shipping_rate_data: {
          type: "fixed_amount",
          display_name: "Standard shipping",
          fixed_amount: { amount: order.shippingAmount, currency: "usd" },
          tax_behavior: "exclusive",
          tax_code: "txcd_92010001",
          metadata: { kind: "shipping", checkout_request_id: order.requestId },
        },
      },
    ]
    const session = await services.stripe.checkout.sessions.create(params, {
      idempotencyKey: `store-checkout-${order.requestId}`,
    })
    if (session.livemode !== services.expectedLivemode || (session.livemode && !services.liveFulfillment)) {
      await services.stripe.checkout.sessions.expire(session.id)
      throw new CheckoutError("CHECKOUT_MODE_MISMATCH", "Checkout is unavailable while we check the payment settings.")
    }
    if (!session.url) throw new CheckoutError("CHECKOUT_UNAVAILABLE", "Checkout could not open. Please try again.")
    await record.update({ sessionId: session.id, checkoutUrl: session.url })
    return { url: session.url, sessionId: session.id }
  })
}
