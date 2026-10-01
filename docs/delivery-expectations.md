# Delivery expectations

Confirm delivery promises for this store's actual garment, provider, destination and operating process before accepting orders. The neutral template has sample ranges and no approved shipping policy. Read current provider guidance and obtain the owner's decisions; a sample value is not a commitment that can be inherited.

## Shared configuration

`src/lib/store-config-values.ts` supplies `commerce.firstItemShippingCents`, `additionalItemShippingCents` and `deliveryEstimates`. Set them to the reviewed policy, then set `commerce.shippingConfirmed=true`. Fill and review all policy text before `policies.published=true`. Checkout also requires the brand's `configured=true` flag. Zero sample shipping amounts are not permission to offer free shipping.

The shared `src/features/store-policies/delivery-estimates.ts` projects handling, ordinary transit and extended-region transit into store surfaces. Estimates combine printing/handling and carrier transit; Printify submission is not carrier shipment. The existing fulfillment path uses standard shipping (`shipping_method: 1`) and supports the 50 US states plus DC. Other regions or shipping methods require coordinated implementation.

The current date calculation uses `storeConfig.timeZone`, weekdays and observed US federal holidays (`us-federal-v1`). Business day one starts after payment. A different business calendar needs code/tests, not just revised prose. Checkout snapshots freeze the applicable original handling maximum, calendar and time zone; changing configuration later must not extend existing order promises.

Review actual product/provider lead times, peak demand and sample experience. Preserve uncertainty: estimates are not guaranteed arrival dates, and a rolling provider average is not a dependable maximum. Relevant sources include [Printify production guidance](https://help.printify.com/hc/en-us/articles/4483629751825-What-are-Printify-s-production-times-like) and [shipping rates](https://printify.com/shipping-rates/).

## Merchant policy alignment

Configure the new store's own Merchant Center shipping policy only after its website/cart values are ready. Match handling/transit calendars, destination coverage, cutoff and customer charges to the actual implementation. Where the account uses a quantity table, calculate each row from `first + additional × (quantity − 1)` through the cart's maximum; quantities above the supported maximum must not be offered. Verify both ordinary and extended destinations after saving.

The Google feed has no per-product delivery override. Product structured data refers to the shared shipping service, with a one-item rate so a multi-item cart is not represented as costing only the first-shirt charge. Check current [Google delivery-time settings](https://support.google.com/merchants/answer/14949917?hl=en) and [shipping structured data](https://developers.google.com/search/docs/appearance/structured-data/shipping-policy).

## Delay review

The [optional owner alert worker](order-shipping-alerts.md) checks captured live payments, Printify shipment evidence and current Stripe refund state. It reminds the configured support destination before the saved handling window ends and continues while unresolved. It sends no customer messages and performs no refunds.

The owner must review known problems promptly, communicate supported updated dates/cancellation choices, record responses and track revised deadlines. Daily reminders do not replace that process. Read current applicable guidance, including [the FTC's order merchandise rule guidance](https://www.ftc.gov/business-guidance/resources/business-guide-ftcs-mail-internet-or-telephone-order-merchandise-rule), when configuring US policies; the template does not determine the owner's obligations.

Keep daily manual review in place until the worker's credentials, sender, schedule and actual owner receipt are verified. Source tests, provider estimates, saved merchant settings, deployment and actual delivery are separate evidence.
