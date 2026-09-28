"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"

import { storeConfig } from "@/lib/store-config"

import { trackStoreEvent } from "@/features/analytics/track-store-event"
import { metaPixel } from "@/features/analytics/meta-pixel"
import { getOrderAttribution } from "@/features/attribution/get-order-attribution"
import type { OrderAttribution } from "@/features/attribution/order-attribution-schema"
import { calculateCartShipping } from "@/features/checkout/calculate-cart-shipping"
import { isCheckoutSessionId } from "@/features/checkout/is-checkout-session-id"
import { getShippingPolicySummary } from "@/features/store-policies/get-shipping-policy-summary"
import { ShippingEstimateText } from "@/features/store-policies/shipping-estimate-text"

import type { CartState } from "./cart-item"
import { useCart } from "./use-cart"

type ApiError = { error?: string; code?: string }
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

function errorMessage(response: ApiError) {
  if (response.code === "PRICE_CHANGED")
    return "An item’s price has changed. Remove that item from your cart, then open its product page and add your chosen size, color, and quantity again to review the current price."
  if (response.code === "SHIPPING_CHANGED")
    return "Your shipping rate has changed. Refresh this page to review the updated total."
  if (response.code === "NOT_CONFIGURED") return "Checkout isn’t open just yet. Your cart is ready when we are."
  if (response.code === "REQUEST_EXPIRED")
    return "That checkout has expired. Select Checkout again to start a fresh checkout."
  if (["REQUEST_CONFLICT", "PRODUCT_CHANGED", "CHECKOUT_MODE_MISMATCH"].includes(response.code ?? ""))
    return "Your checkout needs a refresh. Select Checkout again to continue."
  return response.error || "That didn’t go through. Please try again in a moment."
}

export function CartCheckout() {
  const { items, subtotal, createCheckoutSnapshot, rememberCheckout } = useCart()
  const checkoutItems = items.map(({ productId, variantId, quantity, unitAmount }) => ({
    productId,
    variantId,
    quantity,
    expectedUnitAmount: unitAmount,
  }))
  const itemsKey = JSON.stringify(checkoutItems)
  const shipping = calculateCartShipping(items)
  const shippingPolicy = getShippingPolicySummary()
  const [error, setError] = useState<{ message: string; itemsKey: string } | null>(null)
  const [pending, setPending] = useState<{ itemsKey: string } | null>(null)
  const activeRequest = useRef<AbortController | null>(null)
  const attempt = useRef<{
    key: string
    requestId: string
    snapshot: CartState["checkouts"][string]
    attribution: OrderAttribution | undefined
    tracked: boolean
  } | null>(null)
  const busy = pending?.itemsKey === itemsKey
  const checkoutEnabled =
    storeConfig.configured && storeConfig.policies.published && storeConfig.commerce.shippingConfirmed

  useEffect(() => () => activeRequest.current?.abort(), [itemsKey])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !checkoutEnabled) return
    const body = { items: checkoutItems, expectedShippingAmount: shipping }
    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller
    setError(null)
    setPending({ itemsKey })
    try {
      const key = JSON.stringify(body)
      const attribution = getOrderAttribution()
      if (attempt.current?.key !== key)
        attempt.current = {
          key,
          requestId: crypto.randomUUID(),
          snapshot: createCheckoutSnapshot(),
          attribution,
          tracked: false,
        }
      const checkoutAttempt = attempt.current
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...body,
          requestId: checkoutAttempt.requestId,
          // A retry keeps its original source; a later privacy opt-out stops sending it.
          attribution: attribution ? checkoutAttempt.attribution : undefined,
        }),
        signal: controller.signal,
      })
      const result = (await response.json()) as { url?: string; sessionId?: string } & ApiError
      if (controller.signal.aborted) return
      if (!response.ok) {
        if (
          [
            "SHIPPING_CHANGED",
            "PRICE_CHANGED",
            "REQUEST_EXPIRED",
            "REQUEST_CONFLICT",
            "PRODUCT_CHANGED",
            "CHECKOUT_MODE_MISMATCH",
          ].includes(result.code ?? "")
        ) {
          attempt.current = null
        }
        throw new Error(errorMessage(result))
      }
      const checkoutUrl = result.url ? new URL(result.url) : null
      const isStripeCheckout =
        checkoutUrl?.origin === "https://checkout.stripe.com" && !checkoutUrl.username && !checkoutUrl.password
      const isOrderStatus =
        checkoutUrl?.href ===
        `${window.location.origin}/checkout/success?session_id=${encodeURIComponent(result.sessionId ?? "")}`
      if (!checkoutUrl || (!isStripeCheckout && !isOrderStatus) || !isCheckoutSessionId(result.sessionId)) {
        throw new Error("We couldn’t open secure checkout. Please try again.")
      }
      rememberCheckout(result.sessionId, checkoutAttempt.snapshot)
      if (isStripeCheckout && !checkoutAttempt.tracked) {
        checkoutAttempt.tracked = true
        trackStoreEvent({ name: "begin_checkout", subtotalUsd: subtotal / 100 })
        metaPixel.track({ name: "InitiateCheckout", items })
      }
      window.location.assign(checkoutUrl.href)
    } catch (caught) {
      if (!controller.signal.aborted)
        setError({ message: caught instanceof Error ? caught.message : "Please try again in a moment.", itemsKey })
    } finally {
      if (activeRequest.current === controller) setPending(null)
    }
  }

  if (!checkoutEnabled) {
    return (
      <section aria-labelledby="checkout-heading" className="rounded-2xl border border-border bg-background p-5 sm:p-8">
        <h2 id="checkout-heading" className="display-heading text-3xl">
          The store isn’t open for orders yet.
        </h2>
        <p role="status" className="mt-4 leading-relaxed text-muted-foreground">
          We’re preparing checkout and confirming our shipping and store policies. Your cart will be here when we’re
          ready.
        </p>
        <button className="button mt-6 w-full" disabled>
          Checkout unavailable
        </button>
      </section>
    )
  }

  return (
    <section
      aria-labelledby="checkout-heading"
      className="rounded-2xl border border-foreground/15 bg-background p-5 sm:p-8"
    >
      <p className="mb-2 text-xs font-bold tracking-[0.16em] uppercase">Next stop: your doorstep</p>
      <h2 id="checkout-heading" className="display-heading text-3xl">
        Let’s get it to you.
      </h2>
      <p className="mt-3 text-sm leading-6 text-foreground/75">
        US shipping is {shippingPolicy.rate}. Add your delivery and contact details once, at secure checkout.
      </p>
      <p className="mt-3 text-sm leading-6 text-foreground/75">
        <ShippingEstimateText>{shippingPolicy.delivery}</ShippingEstimateText>
      </p>
      <form className="mt-7" onSubmit={submit}>
        <div className="border-t border-foreground/15 pt-5" aria-live="polite" aria-atomic="true">
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt>Subtotal</dt>
              <dd>{usd.format(subtotal / 100)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>US shipping</dt>
              <dd>{usd.format(shipping / 100)}</dd>
            </div>
            <div className="flex justify-between gap-4 border-t border-foreground/15 pt-4 text-lg font-bold">
              <dt>Total before tax</dt>
              <dd>{usd.format((subtotal + shipping) / 100)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs leading-5 text-foreground/70">
            All prices in USD. Final total shown in Stripe Checkout. Products are made to order.
          </p>
        </div>
        {error?.itemsKey === itemsKey ? (
          <p role="alert" className="mt-5 rounded-xl bg-destructive/12 p-4 text-sm leading-6 text-destructive">
            {error.message}
          </p>
        ) : null}
        <button
          className="button button-accent mt-6 w-full disabled:cursor-wait disabled:opacity-60"
          type="submit"
          disabled={busy}
        >
          {busy ? "Opening secure checkout…" : "Checkout"}
        </button>
        <p className="mt-4 text-center text-xs text-foreground/70">Your card details are handled by Stripe.</p>
      </form>
    </section>
  )
}
