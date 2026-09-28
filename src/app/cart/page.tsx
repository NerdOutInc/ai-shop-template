import type { Metadata } from "next"

import { CartContent } from "@/features/cart/cart-content"

export const metadata: Metadata = { title: "Your cart", robots: { index: false, follow: false } }

export default async function CartPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const { checkout } = await searchParams
  return (
    <main id="main-content" tabIndex={-1} className="page-width py-10 sm:py-16">
      <h1 className="display-heading mb-10 text-5xl sm:text-6xl">Your cart.</h1>
      <CartContent cancelled={checkout === "cancelled"} />
    </main>
  )
}
