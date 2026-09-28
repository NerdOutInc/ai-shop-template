import type { Metadata } from "next"

import { getShippingPolicySummary } from "@/features/store-policies/get-shipping-policy-summary"
import { ShippingPolicyDetails } from "@/features/store-policies/shipping-policy-details"
import { storeConfig } from "@/lib/store-config"

import { StorePolicyContent } from "@/app/_components/store-policy-content"
import { ShippingStructuredData } from "./_components/shipping-structured-data"

export const metadata: Metadata = {
  title: "Shipping & care",
  description: `Shipping & care for ${storeConfig.name}.`,
  alternates: { canonical: "/shipping" },
}

export default function ShippingPage() {
  const shipping = getShippingPolicySummary()
  return (
    <main id="main-content" tabIndex={-1} className="page-width prose-page">
      <ShippingStructuredData />
      <h1 className="display-heading">Shipping & care</h1>
      <ShippingPolicyDetails />
      {storeConfig.policies.published && <h2>Additional shipping & care information</h2>}
      {shipping.available && (
        <p>
          These notes supplement the shipping rates, destinations, and estimates above. They do not change checkout
          charges.
        </p>
      )}
      <StorePolicyContent paragraphs={storeConfig.policies.shippingText} />
    </main>
  )
}
