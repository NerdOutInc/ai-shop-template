import { cartLimits } from "@/lib/cart-limits"

import { deliveryEstimates } from "./delivery-estimates"
import { getShippingPolicySummary } from "./get-shipping-policy-summary"
import { getStorePolicyIds } from "./get-store-policy-ids"

export function createShippingService(siteUrl: URL) {
  const { available, firstShirtAmount, free, destination, rate, delivery, deliveryRegions } = getShippingPolicySummary()
  if (!available) return null
  const { handling, businessDays } = deliveryEstimates
  const period = ({ min, max }: { min: number; max: number }) => ({
    "@type": "ServicePeriod" as const,
    duration: { "@type": "QuantitativeValue" as const, minValue: min, maxValue: max, unitCode: "DAY" },
    businessDays,
  })
  return {
    "@type": "ShippingService" as const,
    "@id": getStorePolicyIds(siteUrl).shippingService,
    name: "Standard shipping",
    description: `Shipping to ${destination} is ${rate}. ${delivery}`,
    handlingTime: period(handling),
    shippingConditions: deliveryRegions.map(({ regions, transit }) => ({
      "@type": "ShippingConditions" as const,
      // A zero first-item rate alone does not make larger carts free.
      numItems: { "@type": "QuantitativeValue" as const, maxValue: free ? cartLimits.maxTotalQuantity : 1 },
      shippingDestination: {
        "@type": "DefinedRegion" as const,
        addressCountry: "US",
        addressRegion: regions,
      },
      shippingRate: { "@type": "MonetaryAmount" as const, value: firstShirtAmount / 100, currency: "USD" },
      transitTime: period(transit),
    })),
  }
}
