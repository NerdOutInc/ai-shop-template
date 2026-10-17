import Link from "next/link"

import { getShippingPolicySummary } from "@/features/store-policies/get-shipping-policy-summary"
import { ShippingEstimateText } from "@/features/store-policies/shipping-estimate-text"

export function ProductShippingSummary() {
  const shippingPolicy = getShippingPolicySummary()
  if (!shippingPolicy.available) return null

  return (
    <aside aria-label="Shipping summary" className="mt-4 space-y-2 text-sm leading-relaxed">
      <p>
        <span className="font-semibold">Shipping:</span> {shippingPolicy.rate}.
      </p>
      <p className="text-muted-foreground">Ships to {shippingPolicy.destination} only.</p>
      <p className="text-muted-foreground">
        <ShippingEstimateText>{shippingPolicy.delivery}</ShippingEstimateText>
      </p>
      <Link className="inline-flex min-h-11 items-center underline underline-offset-4" href="/shipping">
        Full shipping details
      </Link>
    </aside>
  )
}
