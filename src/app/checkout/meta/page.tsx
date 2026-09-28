import type { Metadata } from "next"

import type { MetaCartSearchParams } from "@/features/cart/parse-meta-cart"
import { resolveMetaCart } from "@/features/cart/resolve-meta-cart.server"

import { MetaCheckoutContent } from "./_components/meta-checkout-content"
import { MetaCheckoutRecovery } from "./_components/meta-checkout-recovery"

export const metadata: Metadata = {
  title: "Review your selection",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
}

export default async function MetaCheckoutPage({ searchParams }: { searchParams: Promise<MetaCartSearchParams> }) {
  const params = await searchParams
  const hasSelection = params.products !== undefined || params.coupon !== undefined
  return (
    <main id="main-content" tabIndex={-1} className="page-width py-10 sm:py-16">
      <h1 className="display-heading mb-10 text-4xl sm:text-6xl">Review your selection.</h1>
      {hasSelection ? <MetaCheckoutContent result={await resolveMetaCart(params)} /> : <MetaCheckoutRecovery />}
    </main>
  )
}
