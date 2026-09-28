import { deliveryEstimates } from "./delivery-estimates"
import { getShippingPolicySummary } from "./get-shipping-policy-summary"
import { ShippingEstimateText } from "./shipping-estimate-text"

export function ShippingPolicyDetails() {
  const policy = getShippingPolicySummary()
  if (!policy.available) {
    return <p>Shipping rates and delivery estimates are being confirmed. Checkout is not open yet.</p>
  }
  return (
    <section aria-labelledby="shipping-rates-heading">
      <h2 id="shipping-rates-heading">Shipping rates & destinations</h2>
      <p>
        We ship to {policy.destination}. Shipping is {policy.rate}.
      </p>
      <p>These rates are used in your cart and checkout. Other destinations are not currently supported.</p>
      <h2>Printing & delivery</h2>
      <p>Printing and handling take {policy.productionTime}.</p>
      {policy.deliveryRegions.map(({ destination, transitTime, regions }) => (
        <p key={regions.join(",")}>
          After printing, estimated transit is {transitTime} {destination}.
        </p>
      ))}
      <p>
        <ShippingEstimateText>{policy.delivery}</ShippingEstimateText> Arrival dates are estimates.
      </p>
      <p>{deliveryEstimates.calendar}</p>
    </section>
  )
}
