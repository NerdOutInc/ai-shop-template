# Storefront shipping and policy content

`storeConfig.commerce` owns the first-shirt and additional-shirt shipping amounts and handling/transit estimates. Checkout's supported regions own the destination list. The shipping page, product details, cart and shipping structured data use those same values. Changing prose does not change a shipping charge. Shipping should have one calculator, even when the copy has personality.

Set `commerce.shippingConfirmed` only after checking the owner's amounts and delivery rules. Before the brand, policies and shipping are confirmed, the storefront shows a preparation message and omits shipping structured data; a zero draft amount is not advertised as free shipping. A deliberately confirmed zero amount remains valid free shipping.

`policies.shippingText` remains customizable supplemental shipping/care information. It appears after the generated rates and estimates, with an explicit explanation that it does not change checkout charges. Keep that text consistent with the generated terms. Change the structured commerce configuration when amounts or delivery estimates change, and test the cart, checkout, shipping page and product page together. Unsupported destinations or a different calculation require implementation work, not a sentence promising worldwide shipping.

`policies.privacyText` and `policies.returnsText` still need owner review before `policies.published` is enabled. The privacy page also explains the data handled by the running template, so replacing brand prose cannot silently erase its signup, attribution and browser-storage disclosures. Review any new provider or data flow against that runtime explanation. See [drop signup operations](drop-signup.md) for the consent and removal-request workflow.

## Product-page summaries

Confirmed shipping rates, destinations and delivery estimates appear beside Add to cart, as well as in the shipping disclosure and policy page. They remain hidden until brand setup, reviewed policies and shipping confirmation are complete. Zero first-item and additional-item rates are shown as free; a zero first-item rate alone never promises free shipping for a larger order.

The first paragraph of the owner-approved `policies.returnsText` is also the product-page returns summary. Make it concise, explain the store’s actual return/exchange terms, and keep details in subsequent paragraphs. The summary links to the full policy and stays hidden until the store and policies are published. The template does not assume that every print-on-demand store prohibits size or color returns.

A pending checkout retry retains its saved shipping charge, including a saved zero charge, even when the merchant changes shipping settings. New checkouts use the current confirmed rates; retries still recheck item availability and production fingerprints. The Stripe shipping label remains stable to preserve preexisting idempotency payloads.
