"use client"

import Link from "next/link"

import { useCheckoutRecovery } from "@/features/checkout/use-checkout-recovery"

import { MetaCheckoutContent } from "./meta-checkout-content"

export function MetaCheckoutRecovery() {
  const recovery = useCheckoutRecovery("meta")
  if (recovery.data?.kind === "meta") return <MetaCheckoutContent result={recovery.data.result} />
  return (
    <section className="max-w-xl rounded-2xl border border-foreground/15 bg-background p-5 sm:p-8">
      <p role={recovery.error || recovery.gone ? "alert" : "status"} className="leading-7">
        {recovery.gone
          ? "This selection is no longer available in this browser. Reopen the original Facebook or Instagram shopping link, or choose your shirts again. Nothing was added."
          : recovery.error
            ? "We couldn’t reopen this selection just now. Try again, or reopen the original Facebook or Instagram link. Nothing was added."
            : "Reopening your selection. One moment."}
      </p>
      {recovery.error ? (
        <button type="button" className="button button-coral mt-6" onClick={recovery.retry}>
          Try again
        </button>
      ) : null}
      {recovery.gone ? (
        <div className="mt-6 flex flex-wrap items-center gap-5">
          <Link href="/shop" className="button button-coral">
            Browse the shirts
          </Link>
          <Link href="/cart" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">
            View your existing cart
          </Link>
        </div>
      ) : null}
    </section>
  )
}
