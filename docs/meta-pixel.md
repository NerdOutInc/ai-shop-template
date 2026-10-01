# Meta Pixel measurement and activation

The store has a consent-based Meta Pixel runtime, catalog-matched event builders, and checkout URL protection. Tracking defaults off. Account setup, production configuration, and live receipt must be verified separately; passing a test does not put a Pixel on a real wall.

## Configuration

Set these server environment variables only for the approved Vercel Production project:

- `META_PIXEL_ENABLED=true`
- `META_PIXEL_ID=<the verified numeric dataset/Pixel ID>`

`/api/analytics/meta-config` exposes only public configuration with `Cache-Control: no-store`. It disables tracking for missing/invalid configuration, non-production environments, and a non-HTTPS canonical origin. The browser additionally requires its exact origin to match `NEXT_PUBLIC_SITE_URL`. Local browser tests intercept this first-party endpoint and the entire Meta SDK/network; no production test switch or real test conversion is needed.

The separate runtime request is deliberate: the storefront includes prerendered pages, and passing configuration from the root layout would embed those flags in their build-time HTML/RSC. The endpoint keeps activation configuration at the server runtime without making every storefront route dynamic. It costs one request per full document load and delays the consent controls until it succeeds. A failed request leaves tracking off and the controls unavailable for that document; a reload retries configuration. Vercel environment changes still require deployment, and already-mounted pages do not continuously refresh their configuration.

Use this store's verified business portfolio, catalog and dataset identities. Configure `/feeds/meta` with username `meta-catalog` and its own `META_CATALOG_FEED_PASSWORD`; do not reuse Google's feed password. Follow [feed setup](store-setup.md#merchant-feeds-and-meta-checkout), verify saved settings and real imports, and respect the owner's authorization for terms/account changes. A catalog ID is not a Pixel ID. The template supplies no connected account or dataset and does not enable business-wide Conversions API enrollment.

## Consent and delivery

The Privacy page’s **Optional Meta marketing cookies** section uses the same runtime configuration as the footer control. It is hidden until the Pixel is enabled and configured for the current origin, including while configuration is loading or unavailable. Once configured, the disclosure stays visible regardless of the visitor’s consent choice or Global Privacy Control signal.

The footer's **Privacy choices** control opens the same marketing choice shown to visitors without a saved preference. **Allow Meta marketing cookies** and **Decline** use the same prominent button treatment. Shopping remains available either way. The preference expires after 180 days. Global Privacy Control means denial, and another tab's withdrawal or cleared preference stops delivery in the current tab.

The SDK loads only after a current grant. The runtime uses the consent API and `autoConfig: false`, initializes the selected Pixel without advanced-matching identity fields, and sends through `trackSingle`. It has no unconditional beacon or preconnect. The current product and confirmed purchase can be reevaluated after opt-in; earlier declined cart actions are never replayed. At most 20 actions taken after consent may wait for SDK loading. Withdrawal discards that queue, revokes SDK consent, and attempts to clear this site's `_fbp`/`_fbc` cookies. It cannot retract data already sent.

The service's enabled switch gates the remote SDK independently of saved consent or Google's configuration. When disabled, Meta adds no remote script or connection hint. First-party configuration requests still run. `e2e/tracking-activation.spec.ts` checks independent activation, delayed/failed/malformed configuration, navigation, and reloads without contacting either real provider.

Only actual SDK calls count as attempts. Script/configuration/storage failures never block cart operations, status display, or navigation. A separate Meta purchase-attempt store retains at most 100 local markers for 90 days; it reuses the existing Vercel receipt value but does not share Vercel's store. Web Locks serialize tabs where available. Cleared storage, browsers without suitable persistence/locking, and another device can still produce duplicates. Meta provides no ingestion acknowledgment through this call.

## Checkout privacy and recovery

Meta can automatically receive the document URL and referrer. An event-property allowlist cannot protect a checkout capability in either field.

Sensitive `/checkout/success?session_id=…` and `/checkout/meta?products=…&coupon=…` requests first receive a small, isolated first-party handoff document. It has no Meta code, nonce-authorized local styling, a restrictive Content Security Policy, `no-store`, and `no-referrer`. This cleanup also runs while the Pixel is disabled: keeping checkout capabilities out of browser history, copied addresses, and later page referrers is useful independently of marketing. The cost is an extra verification request and full-page load on these sensitive entries.

A unique HttpOnly, same-site cookie retains the exact checkout session for 30 days or a validated, compact shopping selection for 24 hours. Recovery keeps up to eight recent cookies within a 6 KB budget, so newer returns may evict an older entry before its expiry. Clearing browser data also removes recovery. The cleaned history entry does not retain the original capability URL; after expiry or eviction, it cannot reconstruct that URL. Order recovery then directs customers to their Stripe receipt or support without offering a futile retry or suggesting another purchase. A shopping selection can be reopened from its original Facebook or Instagram link. A separately retained original capability URL can start a new handoff, but the store does not promise that customers still have one.

The handoff verifies the cookie before cleaning the address and reloading the normal application. A non-capability selector stays on that browser history entry, preserving independent tabs, reloads, and back/forward navigation while the cookie remains available. The recovery endpoint requires that selector, its matching cookie, and a same-origin POST. It returns the same session used for exact cart-snapshot confirmation, or resolves the saved selection against the current catalog again. Coarse first-touch attribution is preserved through the shared classifier; raw campaign values and referrers are not stored for this handoff.

The cleanup deliberately drops `fbclid` along with the other query parameters. The essential recovery cookie does not preserve an advertising click identifier before a marketing choice. Consequently, a direct Shops handoff cannot establish a new `_fbc` value from that removed click ID, reducing click attribution even if the visitor later opts in. Ordinary public landing pages can still carry `fbclid`; this handoff does not clear an existing consented Meta cookie.

If the initial cookie verification or history replacement fails, the handoff opens the original capability URL with `recovery_unavailable=1`. Synchronous browser API errors and network rejection take the same fallback, and an independent ten-second timer bounds a hung verification without relying on `AbortSignal.timeout`. A visible link also offers the fallback directly. That document's CSP blocks Meta and the runtime permanently withholds tracking for a document with a sensitive URL/referrer. This fallback can miss conversions, but it does not discard the customer's checkout. Network/server failures during later recovery remain retryable; a missing or expired cookie does not. Existing Stripe return URLs, Meta selection review, atomic import, and `cart_origin` attribution remain supported.

## Event contract

| Event              | Trigger and payload                                                                                                                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PageView`         | Once for each eligible route visit after consent. Size/color query updates do not add route visits.                                                                                                                           |
| `ViewContent`      | The current product is visible. Use the shared feed's product-group ID; the builder also supports a specifically selected variant.                                                                                            |
| `AddToCart`        | A product add or complete Meta selection import succeeds. Exact variant IDs, quantities, merchandise value, and USD. One event for the complete import; no event for already-imported selections or failed/limited additions. |
| `InitiateCheckout` | A successful checkout attempt is about to open a validated Stripe destination. Exact variants/quantities and merchandise subtotal in USD. Order-status recovery and repeated openings of the same attempt do not count again. |
| `Purchase`         | The existing status lookup verifies a live, complete, paid Stripe Session matched to the stored order. Exact stored variant IDs/quantities; value is the confirmed total including shipping and tax.                          |

Item IDs match `<24-character lowercase product ID>-<numeric variant ID>`; group IDs are the product ID alone. The builder uses the shared cart/checkout limits and checks integer cents, quantities, duplicate consistency, and purchase totals. The server verifies eligibility once, then passes its `PurchaseConversion | null` into the Meta projection and checks line subtotal consistency. Only the required catalog fields, total, and local marker leave that projection; the marker never enters Meta event parameters.

Pending, test, simulated, mismatched, inconsistent, or recorded reversed payments (`PAYMENT_REVERSED`) do not qualify. Provider/address failures still qualify when payment is valid. The guard only excludes reversals already recorded by fulfillment; it neither fetches fresh charges nor retracts earlier events. Stripe remains the sales ledger. Browser tracking misses people who decline, block scripts, or do not return from Stripe.

## Activation and verification

1. Obtain action-time terms approval, create the dataset, and read back its actual ID and owner. Keep optional business-wide CAPI enrollment off.
2. Connect the dataset to the existing catalog and verify the intended existing ad account before linking it. Verify automatic advanced matching and automatic events are off. Configure traffic permissions for the configured canonical hostname without removing other authorized hosts. Inspect any domain-verification requirement before changing it.
3. Complete source checks and browser verification, including consent/withdrawal, delayed SDK loading, current-view/current-purchase reevaluation, duplicate attempts, cookie/storage failures, separate tabs, reload/retry/back navigation, and captured Pixel URL/referrer fields. Test desktop, narrow viewports, keyboard access, and visible focus.
4. Enable the verified Pixel ID in the production project and deploy the tested commit under the owner's activation request. Read back the canonical hostname, deployed commit, configuration, and actual runtime behavior.
5. Confirm ordinary browsing receipt in Meta Test Events/Events Manager. Purchase ingestion stays pending until a legitimate live order or an explicitly authorized live test; automated fixtures must never reach the real Pixel. CAPI, new ad accounts, ads/spending, and live test purchases remain separate work.

## Official references

- [Standard events and properties](https://developers.facebook.com/documentation/meta-pixel/reference)
- [Consent API and automatically received data](https://developers.facebook.com/documentation/meta-pixel/implementation/gdpr)
- [Manual-only configuration and selective tracking](https://developers.facebook.com/documentation/meta-pixel/advanced)
- [Manual advanced matching](https://developers.facebook.com/documentation/meta-pixel/advanced/advanced-matching)
- [Automatic advanced matching setting](https://www.facebook.com/business/help/1993001664341800)
- [Meta Business Tools Terms](https://business.facebook.com/legal/technology_terms)

## Route and cached-page views

The bootstrap sets `fbq.disablePushState = true` before loading the SDK. Meta's history listener is separate from `autoConfig`; leaving it enabled duplicates the provider's route views and measures color/size query changes. The provider owns same-document route views, including back/forward navigation.

Meta's separate `pageshow` listener still measures a cached-page restore. A capture-phase listener rechecks opt-in consent, Global Privacy Control and document eligibility first; the provider adds no restore view. If a loaded SDK is no longer permitted, the listener stops that restore event before the SDK can queue a view for later replay. This also suppresses later `pageshow` listeners in that event; future restore handlers must account for this privacy boundary. Browser tests model both SDK listeners and dispatch synthetic restore events. They verify event counts and withdrawn consent, without claiming a browser cached a production page.
