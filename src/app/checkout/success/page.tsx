import type { Metadata } from "next"

import { CheckoutStatus } from "@/features/cart/checkout-status"
import { CheckoutSuccessRecovery } from "@/features/checkout/checkout-success-recovery"

export const metadata: Metadata = {
  title: "Order status",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
}

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string | string[] }>
}) {
  const { session_id: sessionId } = await searchParams
  return (
    <main id="main-content" tabIndex={-1} className="page-width py-12 sm:py-20">
      {sessionId !== undefined ? (
        <CheckoutStatus sessionId={typeof sessionId === "string" ? sessionId : null} />
      ) : (
        <CheckoutSuccessRecovery />
      )}
    </main>
  )
}
