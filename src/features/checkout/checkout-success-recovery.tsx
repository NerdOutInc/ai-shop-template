"use client"

import Link from "next/link"

import { CheckoutStatus } from "@/features/cart/checkout-status"
import { supportEmail } from "@/lib/support-email"

import { useCheckoutRecovery } from "./use-checkout-recovery"

export function CheckoutSuccessRecovery() {
  const recovery = useCheckoutRecovery("success")
  if (recovery.data?.kind === "success") return <CheckoutStatus sessionId={recovery.data.sessionId} />
  return (
    <section className="mx-auto max-w-2xl rounded-2xl border border-foreground/15 bg-background px-6 py-12 text-center sm:px-12">
      <h1 className="display-heading text-4xl">Let’s find your checkout.</h1>
      <p role={recovery.error || recovery.gone ? "alert" : "status"} className="mt-6 leading-7">
        {recovery.gone
          ? "This checkout link is no longer available in this browser. Check your Stripe receipt, or contact us with your order reference for an update. Please don’t place another order to check its status."
          : recovery.error
            ? "We couldn’t reopen your checkout just now. Try again, or check your Stripe receipt. This doesn’t mean your payment failed."
            : "Reopening your checkout. One moment, friend."}
      </p>
      {recovery.error ? (
        <button type="button" className="button button-coral mt-6" onClick={recovery.retry}>
          Try again
        </button>
      ) : null}
      {recovery.gone ? (
        <a href={`mailto:${supportEmail}`} className="button button-coral mt-6">
          Contact us about your order
        </a>
      ) : null}
      <p className="mt-6">
        <Link
          href={recovery.gone ? "/shop" : "/cart"}
          className="inline-flex min-h-11 items-center underline underline-offset-4"
        >
          {recovery.gone ? "Browse the shirts" : "Back to your cart"}
        </Link>
      </p>
    </section>
  )
}
