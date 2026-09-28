"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

import { trackPurchaseConversion } from "@/features/analytics/track-purchase-conversion"
import { googleTag } from "@/features/analytics/google-tag"
import { useGoogleTag } from "@/features/analytics/use-google-tag"
import { metaPixel } from "@/features/analytics/meta-pixel"
import { useMetaPixel } from "@/features/analytics/use-meta-pixel"
import { isCheckoutSessionId } from "@/features/checkout/is-checkout-session-id"

import { useCart } from "./use-cart"

type OrderStatus = {
  paymentStatus: "pending" | "paid" | "expired" | "failed"
  fulfillmentStatus: "pending" | "submitted" | "action_required" | "simulated"
  purchase?: unknown
  metaPurchase?: unknown
  googlePurchase?: unknown
}

export function CheckoutStatus({ sessionId }: { sessionId: string | null }) {
  const { confirmPurchase, hydrated } = useCart()
  const [status, setStatus] = useState<OrderStatus | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [polling, setPolling] = useState(true)
  const { ready: googleReady } = useGoogleTag()
  const { ready: metaReady } = useMetaPixel()
  const validSession = isCheckoutSessionId(sessionId)

  useEffect(() => {
    if (!validSession || !hydrated) return
    const controller = new AbortController()
    let timeout: ReturnType<typeof setTimeout> | undefined
    let pollCount = 0
    async function refresh() {
      try {
        const response = await fetch(`/api/checkout/status?session_id=${encodeURIComponent(sessionId!)}`, {
          signal: controller.signal,
          cache: "no-store",
        })
        if (!response.ok) throw new Error("Status unavailable")
        const result = (await response.json()) as OrderStatus
        if (
          !["pending", "paid", "expired", "failed"].includes(result.paymentStatus) ||
          !["pending", "submitted", "action_required", "simulated"].includes(result.fulfillmentStatus)
        )
          throw new Error("Invalid order status")
        if (controller.signal.aborted) return
        setStatus(result)
        setError(false)
        if (result.paymentStatus === "paid") {
          confirmPurchase(sessionId!)
          if (result.fulfillmentStatus !== "simulated") void trackPurchaseConversion(result.purchase)
        }
        if (
          (result.paymentStatus === "pending" ||
            (result.paymentStatus === "paid" && result.fulfillmentStatus === "pending")) &&
          ++pollCount < 12
        ) {
          timeout = setTimeout(() => void refresh(), 5000)
        } else setPolling(false)
      } catch {
        if (!controller.signal.aborted) {
          setError(true)
          setPolling(false)
        }
      }
    }
    void refresh()
    return () => {
      controller.abort()
      clearTimeout(timeout)
    }
  }, [sessionId, validSession, hydrated, attempt, confirmPurchase])

  useEffect(() => {
    if (metaReady && status?.paymentStatus === "paid" && status.fulfillmentStatus !== "simulated")
      void metaPixel.trackPurchase(status.metaPurchase)
  }, [metaReady, status])

  useEffect(() => {
    if (googleReady && status?.paymentStatus === "paid" && status.fulfillmentStatus !== "simulated")
      void googleTag.trackPurchase(status.googlePurchase)
  }, [googleReady, status])

  function retry() {
    setError(false)
    setPolling(true)
    setAttempt((value) => value + 1)
  }

  const paid = status?.paymentStatus === "paid"
  const title = !validSession
    ? "Let’s find your checkout."
    : paid
      ? "Your order is confirmed."
      : status?.paymentStatus === "expired"
        ? "That checkout has expired."
        : status?.paymentStatus === "failed"
          ? "Your payment didn’t go through."
          : "Checking your payment."
  return (
    <section className="mx-auto max-w-2xl rounded-2xl border border-foreground/15 bg-background px-6 py-12 text-center sm:px-12 sm:py-16">
      <p className="text-xs font-bold tracking-[0.16em] uppercase">
        {paid ? "Thanks for shopping with us" : "One moment, friend"}
      </p>
      <h1 className="display-heading mt-4 text-4xl sm:text-5xl">{title}</h1>
      <div role="status" aria-live="polite" className="mt-6 space-y-4 leading-7 text-foreground/80">
        {!validSession ? (
          <p>
            This link doesn’t include a valid checkout. You can return to your cart or check the receipt from Stripe.
          </p>
        ) : null}
        {validSession && !status && !error ? (
          <p>We’re confirming your payment with Stripe. Keep this page open for a moment.</p>
        ) : null}
        {status?.paymentStatus === "pending" ? (
          <p>Your payment hasn’t been confirmed yet. Please don’t place another order while it’s processing.</p>
        ) : null}
        {status?.paymentStatus === "expired" ? (
          <p>No completed payment is recorded for this checkout. Your cart is ready if you’d like another go.</p>
        ) : null}
        {status?.paymentStatus === "failed" ? (
          <p>
            Stripe couldn’t complete this payment. Your cart is still here if you’d like to try another payment method.
          </p>
        ) : null}
        {paid && status.fulfillmentStatus === "pending" ? (
          <p>
            Your payment is confirmed. We’re getting your order ready for our printing partner. There’s nothing else you
            need to do.
          </p>
        ) : null}
        {paid && status.fulfillmentStatus === "submitted" ? (
          <p>
            Your payment is confirmed and your order is with our printing partner. Your new favorite shirt is officially
            on its way to becoming a shirt.
          </p>
        ) : null}
        {paid && status.fulfillmentStatus === "action_required" ? (
          <p>
            Your payment is confirmed. Your order needs a little attention before printing, and our team will handle it.
            Please don’t place the order again.
          </p>
        ) : null}
        {paid && status.fulfillmentStatus === "simulated" ? (
          <p>This was a successful test payment. No real order was sent for printing, and no shirt will be shipped.</p>
        ) : null}
        {error ? (
          <p>
            We couldn’t refresh your order status. A slow connection doesn’t mean your payment failed. Check your Stripe
            receipt and try refreshing here before placing another order.
          </p>
        ) : null}
        {!polling && !error && status?.paymentStatus === "pending" ? (
          <p>Still waiting on confirmation. You can check again below.</p>
        ) : null}
      </div>
      {validSession &&
      !polling &&
      (error || status?.paymentStatus === "pending" || (paid && status.fulfillmentStatus === "pending")) ? (
        <button type="button" onClick={retry} className="button button-coral mt-8">
          Check order status
        </button>
      ) : null}
      <div className="mt-8 flex flex-wrap justify-center gap-4">
        <Link href="/shop" className="button button-coral">
          Keep shopping
        </Link>
        {!paid ? (
          <Link href="/cart" className="button">
            Back to your cart
          </Link>
        ) : null}
      </div>
    </section>
  )
}
