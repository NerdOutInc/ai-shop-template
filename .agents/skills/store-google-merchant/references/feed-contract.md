# Current feed contract and brand adaptation

Read current code before relying on this reference. This describes the existing implementation; it is not evidence that any particular account or deployment is configured.

## Source and response behavior

- [Store setup](../../../../docs/store-setup.md#merchant-feeds-and-meta-checkout) documents `/feeds/google`, `/feeds/meta`, and their separate production activation.
- The [Google route](../../../../src/app/feeds/google/route.ts) and [Meta route](../../../../src/app/feeds/meta/route.ts) use one [handler](../../../../src/features/merchant-feed/create-merchant-feed-handler.server.ts) that checks indexable production context and destination authentication before any catalog read. Missing/incorrect credentials, an unset destination password, and previews return 404. Successful responses contain XML; read or validation failures return 503 with `Retry-After: 300`. Responses use `Cache-Control: private, no-store`.
- [Authentication](../../../../src/features/merchant-feed/is-merchant-feed-authorized.server.ts) uses Basic username `google-merchant` with `GOOGLE_MERCHANT_FEED_PASSWORD` for Google, and `meta-catalog` with `META_CATALOG_FEED_PASSWORD` for Meta. Each [environment configuration](../../../../.env.example) password is optional until its endpoint is activated and must be 32–256 characters when set. There is no credential fallback between destinations. Rotate or revoke each password independently with its corresponding source authentication when its credential changes.
- [Merchant product loading](../../../../src/features/merchant-feed/get-merchant-products.server.ts) reads active published snapshots and fresh Printify production/stock state. Published prices, copy, and images remain authoritative; saved draft display edits stay private. Overlapping reads share work, but there is no stale complete-feed fallback.
- [Variant listings](../../../../src/features/catalog/get-product-variant-listings.ts) produce unambiguous color/size landing links and matching color photos. Missing or ambiguous data must not quietly omit variants from an otherwise successful feed.
- The Meta XML adds `quantity_to_sell_on_facebook`: `999999` for purchasable variants and `0` for unavailable variants. This is the project's convention for effectively unlimited made-to-order selling availability, not physical stock or a documented Meta infinity value. Google XML does not include this field. Checkout still verifies current Printify eligibility.

The publishing pipeline supplies hosted garment mockups to the published catalog, feed and structured data. The feed itself does not require Blob-hosted URLs or check public object availability; the feed serializer can accept an unhosted provider URL, so successful XML alone cannot verify storage. Follow [Blob image operations](../../store-publishing-recovery/references/product-images.md) for storage and direct-source verification. Optimized storefront image delivery, complete XML and Google crawl/approval are separate checks.

Hide/delete remove products on the next successful refresh; stock depletion keeps variants as `out_of_stock`. Changed printable production settings can pause eligibility until the merchant publishes a matching snapshot. Provider failures must not become empty catalogs, partial catalogs, or false stock updates. Diagnose 503 failures using sanitized reason codes and the publishing health check. Correct the diagnosed configuration, provider, code, or snapshot problem; republish only when published product data needs changing and publication is authorized. Do not bypass validation to make an import green.

## Reviewed Google copy

Use the [private Google copy editor and maintenance guide](../../../../docs/google-merchant-copy.md) for separately reviewed Google descriptions. Bind approval to the current saved facts and exact color/size identities. Generated copy retains its origin after human edits or guarded clear and uses Google structured descriptions. Changed facts, unreviewed variants or invalid saved copy fall back to the published description; they never silently remove feed items. This metadata does not edit storefront storytelling or Meta copy and does not activate a feed. Preview is read-only; applying or clearing production copy requires the owner's existing explicit authorization. Do not import another store's products, prose or pilot approvals.

## Meta import acceptance

Activation and real-import evidence remain pending until these steps are completed under the existing production/account authorization:

1. Configure `META_CATALOG_FEED_PASSWORD`, deploy, and verify that `/feeds/meta` returns complete XML with `meta-catalog` authentication and rejects anonymous access. A secret edit alone does not update the running deployment.
2. Create the intended Commerce Manager source with `/feeds/meta`, its credentials and schedule. If continuing this store’s setup, reuse its verified existing source and remove diagnostic manual quantity overrides that could mask the feed.
3. Trigger a real fetch and record the source URL, processing time, item count, and diagnostics. In Commerce Manager, read back exact variant IDs and feed-source provenance for an available variant with quantity `999999` and an unavailable variant with quantity `0`. If no unavailable variant exists, leave that case pending rather than changing sellable inventory solely for the check.
4. If the quantity is ignored, inspect importer diagnostics and the submitted element before changing serialization. Local XML assertions, unit/browser tests, and a manual Commerce Manager quantity edit do not exercise Meta's parser. Leave quantity import unverified until feed-derived values are confirmed; check shop publication separately.

Record a later scheduled refresh separately when observed. A successful triggered fetch does not establish that the schedule has run.

## Garment profiles and brand adaptation

[Snapshot preparation](../../../../src/features/merchant-feed/prepare-merchant-product.server.ts) uses the published blueprint's complete, shop-scoped profile from **Garment models** in admin. The feeds and publishing health bulk-read those profiles on every request; the fresh baseline includes their schema. There is no blueprint allowlist or T-shirt fallback. Profile edits need no republish. A missing or incomplete profile produces `UNSUPPORTED_BLUEPRINT`, and malformed apparel values produce `UNSUPPORTED_APPAREL`. One invalid shown product fails the complete feed with 503 rather than being omitted; health also validates hidden active products. Verify the actual garment facts before configuring the profile. The generator uses configured brand labels and USD pricing; [site URL resolution](../../../../src/lib/get-site-url.ts) requires the store’s canonical origin.

A new brand needs its own origin, brand/contact/policy facts, approved product profile and identifiers, country/language/currency, account/source, and refresh timezone. This is configuration and product-model work; changing the Merchant account name alone cannot perform it. Keep private account details in the operational setup, not this reusable skill.

For regression validation after feed code changes, use the existing route, generator, loader, and publishing browser tests. Exercise publication updates, hide/show/delete, an unavailable provider, stock/production changes, authentication, and consistency among the feed, product page, and checkout. Follow repository validation requirements rather than treating successful XML serialization as sufficient.
