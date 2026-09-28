import { calculateCartShipping } from "@/features/checkout/calculate-cart-shipping"
import { usShippingRegions } from "@/features/checkout/us-shipping-regions"

import { deliveryEstimates } from "./delivery-estimates"

// This geographic reference only selects friendly wording; checkout owns the enabled destinations.
const allStatesAndDc = new Set(
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(
    " "
  )
)
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
const list = new Intl.ListFormat("en-US", { style: "long", type: "conjunction" })
const contiguousStatesAndDc = new Set([...allStatesAndDc].filter((region) => region !== "AK" && region !== "HI"))

function describeRegions(regions: string[]) {
  if (regions.length === contiguousStatesAndDc.size && regions.every((region) => contiguousStatesAndDc.has(region)))
    return "in the contiguous US and Washington, DC"
  const names: Record<string, string> = { AK: "Alaska", HI: "Hawaii", DC: "Washington, DC" }
  return `to ${list.format(regions.map((region) => names[region] ?? region))}`
}

export function getShippingPolicySummary() {
  const firstShirtAmount = calculateCartShipping([{ quantity: 1 }])
  const additionalShirtAmount = calculateCartShipping([{ quantity: 2 }]) - firstShirtAmount
  const destinations = new Set(usShippingRegions)
  const { handling, transit, extendedTransit, extendedRegions } = deliveryEstimates
  const productionTime = `${handling.min}–${handling.max} business days`
  // The same nonempty groups drive every delivery claim and the structured data.
  const deliveryRegions = [
    { regions: [...destinations].filter((region) => !extendedRegions.includes(region)), transit },
    { regions: [...destinations].filter((region) => extendedRegions.includes(region)), transit: extendedTransit },
  ]
    .filter(({ regions }) => regions.length > 0)
    .map(({ regions, transit }) => ({
      regions,
      transit,
      destination: describeRegions(regions),
      transitTime: `${transit.min}–${transit.max} business days`,
      deliveryTime: `${handling.min + transit.min}–${handling.max + transit.max} business days`,
    }))
  const destination =
    destinations.size === allStatesAndDc.size && [...destinations].every((region) => allStatesAndDc.has(region))
      ? "all 50 US states and Washington, DC"
      : `these US destinations: ${[...destinations].join(", ")}`

  return {
    firstShirtAmount,
    destination,
    productionTime,
    deliveryRegions,
    delivery: deliveryRegions.length
      ? `Estimated delivery, including printing: ${deliveryRegions.map(({ deliveryTime, destination }) => `${deliveryTime} ${destination}`).join("; ")}.`
      : "Shipping is currently unavailable.",
    rate: `${usd.format(firstShirtAmount / 100)} for the first shirt, plus ${usd.format(additionalShirtAmount / 100)} for each additional shirt`,
  }
}
