# Google Merchant Center purchase tracking

Google's account setup and receipt of real website events are separate milestones. An Active source is ready to listen; it does not mean a purchase has reached the summit.

## Configure this store's own source

Create or select the intended Merchant Center purchase source and Google tag. Record only non-secret identifiers in local setup state. Verify account, destination and attribution settings; the template has no preselected account or tag.

Keep the purchase URL blank: purchases are emitted only after server-side live-payment verification. Disable automatic history pageviews, scrolls, outbound clicks, form interactions, videos, downloads, user-provided data capabilities and automatic customer-data detection. Read those settings back before activation. Account readiness, installation detection and actual event receipt are separate results.

## Prepared website integration

The runtime defaults off and requires both a production deployment on the canonical HTTPS origin and a separate Google permission. Existing Meta permission never grants Google permission.

After activation and release are approved, configure the intended Vercel Production project:

```dotenv
GOOGLE_TAG_ENABLED=true
GOOGLE_TAG_ID=YOUR_VERIFIED_TAG_ID
```

The dynamic, uncached `/api/analytics/google-config` endpoint avoids freezing activation flags in prerendered storefront pages. Previews and development return disabled configuration. Environment changes still require deployment. Verify the final canonical deployment and configuration before claiming activation.

The prepared consent control appears in the storefront's bottom panel and can be reopened with **Privacy choices** in the footer. Google and Meta have independent choices. Preferences expire after 180 days; GPC overrides a grant. Withdrawal and cross-tab changes stop application measurement and attempt to clear this site's Google marketing cookies. Withdrawal may send a consent-control update, and cannot retract previously delivered data.

**Allow Google marketing cookies** grants `ad_storage`, `analytics_storage`, and `ad_user_data` for advertising and analytics measurement. `ad_personalization` remains denied. The banner and privacy disclosure describe this scope explicitly; this is not anonymous or analytics-only consent. See [Google's consent API definitions](https://developers.google.com/tag-platform/gtagjs/reference#consent).

The Privacy page's **Optional Google marketing cookies** section uses the same runtime configuration as the footer control. It stays hidden while configuration is loading, disabled, unavailable, invalid, or for another origin. Once Google is configured for this site, the disclosure stays visible regardless of the visitor's consent choice or Global Privacy Control signal, matching the Meta disclosure.

The Google SDK loads only after permission and a safe document check. A sensitive checkout URL/referrer or private admin/auth document permanently blocks Google for that document. Existing checkout ingress cleans capability URLs before rendering the normal application. Explicit page fields contain a public path and, when valid, Merchant Center's `srsltid`; no arbitrary query values, fragments, referrer, or page title are supplied. The SDK can read browser document information, so the ingress protection and account-side automatic-collection settings remain necessary.

The app does not preserve `srsltid` before consent. If a visitor leaves the landing URL before opting in, that listing-click identifier is no longer available to the tag; Merchant Center attribution may therefore miss the original click.

The service's enabled switch gates the remote SDK independently of saved consent or Meta's configuration. When disabled, Google adds no remote script or connection hint. First-party configuration requests still run. `e2e/tracking-activation.spec.ts` verifies both services' independent switches, delayed/failed/malformed configuration, navigation, and reloads with saved grants; all external requests are intercepted locally.

Google gets `page_view` and verified `purchase` events. Ad personalization, Google Signals, URL passthrough, and customer-data matching are not enabled by this integration. Never add real tags to browser fixtures or send synthetic purchases to the production source.

## Purchase contract

The existing Stripe status lookup establishes live, complete, paid eligibility and verifies the stored order's identity and arithmetic. The Google projection adds no Stripe requests. Test, simulated, unpaid, expired, mismatched, inconsistent, and recorded reversed payments produce no Google purchase. A paid order needing fulfillment assistance still qualifies.

Google's `value` is the merchandise subtotal; shipping and tax are separate USD fields. Items use the feed's exact `<product-id>-<variant-id>`, unit price, and quantity. A destination-specific SHA-256 identifier derived from the high-entropy Stripe session supplies `transaction_id` without sending the raw checkout capability or the existing local Vercel/Meta marker. Customer contacts, delivery addresses, provider references, and payment details are excluded.

The browser retains at most 100 independent Google attempt markers for 90 days. Web Locks coordinate tabs where available. Markers record a queued SDK attempt, not Google's ingestion acknowledgment. Cleared storage, other devices, blockers, declining permission, and not returning from Stripe affect coverage. Recorded reversals suppress new attempts but do not retract earlier events; Stripe remains the sales ledger.

## Release verification

1. Review the privacy wording and consent behavior before approving activation.
2. Read back the source's tag, destination, blank purchase URL, and disabled automatic collection settings. Confirm that the intended Merchant Center source is the tag's only destination: no Google Ads, GA4, or other destinations may be linked. [Adding destinations sends tag data to those destinations](https://support.google.com/tagmanager/answer/12329709?hl=en); repeat this check after any account-side tag change, and review consent scope before linking another destination.
3. Run repository checks and offline browser cases for consent, withdrawal, GPC, checkout cleanup, payment eligibility, and reload deduplication. Exercise the independent privacy controls on desktop and narrow screens with a keyboard.
4. Merge and deploy only under an explicit release request. Confirm the deployed revision and public configuration.
5. Check Google installation detection and ordinary consented page receipt. Purchase receipt remains pending until a legitimate live order or a separately authorized live test. Do not mark tracking verified solely because Merchant Center lists the source as Active.

## Official references

- [Merchant Center direct Google tag setup](https://support.google.com/merchants/answer/15322730?hl=en)
- [Purchase events](https://support.google.com/merchants/answer/13071852)
- [Google event fields](https://developers.google.com/tag-platform/gtagjs/reference/events#purchase)
- [Consent mode](https://developers.google.com/tag-platform/security/guides/consent)
- [Google's use of key-event data](https://support.google.com/merchants/answer/14763078?hl=en)
