# Storefront shipping and policy content

`storeConfig.commerce` owns the first-shirt and additional-shirt shipping amounts and handling/transit estimates. Checkout's supported regions own the destination list. The shipping page, product details, cart and shipping structured data use those same values. Changing prose does not change a shipping charge. Shipping should have one calculator, even when the copy has personality.

Set `commerce.shippingConfirmed` only after checking the owner's amounts and delivery rules. Before the brand, policies and shipping are confirmed, the storefront shows a preparation message and omits shipping structured data; a zero draft amount is not advertised as free shipping. A deliberately confirmed zero amount remains valid free shipping.

`policies.shippingText` remains customizable supplemental shipping/care information. It appears after the generated rates and estimates, with an explicit explanation that it does not change checkout charges. Keep that text consistent with the generated terms. Change the structured commerce configuration when amounts or delivery estimates change, and test the cart, checkout, shipping page and product page together. Unsupported destinations or a different calculation require implementation work, not a sentence promising worldwide shipping.

`policies.privacyText` and `policies.returnsText` still need owner review before `policies.published` is enabled. The privacy page also explains the data handled by the running template, so replacing brand prose cannot silently erase its signup, attribution and browser-storage disclosures. Review any new provider or data flow against that runtime explanation. See [drop signup operations](drop-signup.md) for the consent and removal-request workflow.

## Product-page summaries

Confirmed shipping rates, destinations and delivery estimates appear beside Add to cart, and on the shipping policy page. The care disclosure links to that policy without repeating the rates and estimates. They remain hidden until brand setup, reviewed policies and shipping confirmation are complete. Zero first-item and additional-item rates are shown as free; a zero first-item rate alone never promises free shipping for a larger order.

The optional `policies.returnsSummary` is a separately reviewed product-page summary (at most 240 characters). Leave it blank or omit it to hide the summary; upgrading an existing store never reuses `returnsText` automatically. To opt in, ask the owner to approve concise wording for the store’s actual return/exchange terms and check it beside Add to cart on mobile. Keep the full policy in `returnsText`. The summary links to that policy and stays hidden until the store and policies are published. The template does not assume that every print-on-demand store prohibits size or color returns.

A pending checkout retry retains its saved shipping charge, including a saved zero charge, even when the merchant changes shipping settings. New checkouts use the current confirmed rates; retries still recheck item availability and production fingerprints. The Stripe shipping label remains stable to preserve preexisting idempotency payloads.
