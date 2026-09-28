import type { Metadata } from "next"

import { storeConfig } from "@/lib/store-config"

import { StorePolicyContent } from "@/app/_components/store-policy-content"
import { ShippingStructuredData } from "./_components/shipping-structured-data"

export const metadata: Metadata = {
  title: "Shipping & care",
  description: `Shipping & care for ${storeConfig.name}.`,
  alternates: { canonical: "/shipping" },
}

export default function ShippingPage() {
  return (
    <main id="main-content" tabIndex={-1} className="page-width prose-page">
      <ShippingStructuredData />
      <h1 className="display-heading">Shipping & care</h1>
      <StorePolicyContent paragraphs={storeConfig.policies.shippingText} />
    </main>
  )
}
