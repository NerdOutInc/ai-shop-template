# Printify catalog

The storefront reads published snapshots from its private Postgres catalog. Printify Publish controls listing revisions; saved provider drafts remain private. Product page, feed, sitemap and metadata reads never call Printify. Follow [store setup](store-setup.md) and [publishing setup](printify-publishing.md) before enabling `PRINTIFY_PUBLISHING_ENABLED`.

This template starts with no products, garment profiles, categories or source-store inventory. Its current commerce model is USD with standard shipping to the 50 US states and DC.

## Connect the shop

Configure the intended environment's `PRINTIFY_SHOP_ID` and dedicated read/fulfillment, draft and publishing tokens as described in [store setup](store-setup.md#printify-and-the-first-product). Keep credentials in ignored local or deployment secret storage. Verify the account and shop using current authenticated provider reads; possession of a token does not prove it belongs to this store.

Printify personal access tokens cover the account's shops and expire after one year; separate tokens do not isolate shops or API quotas. Follow the [account isolation, rotation and rate-limit guidance](store-setup.md#printify-and-the-first-product). Use a separate Printify account per brand when account-level isolation is required.

Apply the [fresh database baseline](../supabase/migrations/20260928000354_storefront_baseline.sql) to an empty dedicated database using [the Supabase CLI migration workflow](store-setup.md#database-and-tls), then verify migration history. Configure the restricted runtime role, private artwork storage, public product-image storage, signed webhook and background workers. A new shop's first reviewed product uses an [explicit verified app draft recipe](admin-design-library.md#first-product-with-an-explicit-recipe); later proposals can reuse an already published model. No catalog import or source-store donor is required.

The built-in design colors, design-page draft button and `drafts.propose` are tied to **Next Level 6210 / blueprint 1317 / provider 99**, as defined in [the garment model](../src/features/design-library/garment-model.ts) and [recipe source selection](../src/features/design-products/read-design-recipe-sources.server.ts). Choose that provider for the complete per-design color workflow. Another garment/provider can use a verified explicit front-art recipe, but cannot inherit these assigned colors or automatic proposals. Verify its own variants, placement, pricing, shipping and merchant profile; provider catalog availability alone is not template support.

## Select and order products

Publish the reviewed product in Printify within the owner's authorized scope. A new publication enters the app hidden. Finish its category and garment profile under **Products → Garment models**, then Show it or schedule its release.

The admin **Products** page (`/admin/products`) controls Featured order. Drag a product or use its up/down buttons; each move saves immediately. Hidden and unpublished products retain their positions. A changed lineup is rejected until the page is refreshed, so a stale editor cannot silently overwrite another change. Publish and unpublish in Printify to change provider membership.

**Categories** (`/admin/products/categories`) and **Garment models** (`/admin/products/garments`) are sibling screens. A product with unfinished garment information links to that model and cannot be shown through the app until it is complete.

## Display and refresh behavior

- Prices are saved USD retail cents. Available options require both `is_enabled` and `is_available`. Product detail can show enabled unavailable combinations without allowing their purchase.
- A product with no available variants stays visible as Currently unavailable. Equal prices show one amount; differing prices show From. Descriptions become plain text, with supported size-guide tables parsed into safe rows and cells.
- The selected Primary mockup determines the initial image/color. Galleries retain variant associations and Printify color names. Approved transparent artwork previews are pinned to the exact immutable revision and production fingerprint. Private masters never enter public presentation models.
- Published projections use a five-minute database cache that publication and admin changes invalidate. Stock comes from the last complete background observation, normally refreshed every 30 minutes. Missing stock, a stock observation that does not match the snapshot’s production fingerprint, or observations at least two hours old pause ordering while preserving valid listing content. A snapshot that the current production parser rejects, or a display projection missing a current production fingerprint, is withheld from the catalog; its product page can be unavailable and sitemap reads can fail until the publication is repaired. Checkout and fulfillment still recheck provider state uncached.
- Empty catalogs have an empty state. Missing configuration and read failures report unavailability rather than switching to provider requests. Logs exclude credentials, raw upstream responses and customer payloads.

Configure and verify workers explicitly; `vercel.json` starts without schedules. A commercial Vercel store requires Pro/Enterprise for the supported cadence; Hobby's daily cron cannot keep stock fresh. See [supported hosting](store-setup.md#supported-hosting-and-scheduled-workers) and [background refresh operations](catalog-background-refresh.md).

## Sorting

**Featured** uses saved lineup order and places the current weekly feature first when `storeConfig.features.designOfTheWeek` is enabled. **Newest** uses the product's latest arrival timestamp. **Most Popular** uses quantities on production/fulfilled Printify orders, excluding canceled/unpaid orders, samples and marked reprints. Popularity is a conservative provider signal, not a Stripe revenue report or a fabricated customer rating.

Popularity refreshes run every six hours when the worker is configured. Complete observations remain usable for at most 24 hours; partial scans never replace them. When unavailable, the page explains that it is showing Featured order. The refresh stores product quantities, not addresses or raw orders.

## What the shop shows

`active` records provider publication state. The owner controls `hidden_at`, `reveal_at` and `revealed_at`. Storefront membership requires:

```sql
active and (hidden_at is null or (reveal_at is not null and reveal_at <= now()))
```

The shared visibility predicate belongs to the publishing feature. The cache additionally evaluates time-based reveals so an arrival does not depend on a scheduled job or an open admin page. Hidden product previews at `/admin/products/<product-id>` require administrator access.

Hide preserves product history and weekly assignments. Show requires a complete garment. A scheduled hidden product gets its assigned reveal instant; removing an unstarted assignment removes only that assignment's pending reveal and does not hide a product already selling. For accidental hides, restore the selected products through the admin controls so garment and schedule checks still apply.

### When a product entered the shop

`added_to_shop_at` records the latest arrival used by Newest and the New badge. Products are New for 14 full days after arrival. Initial publication is hidden, so publication alone is not an arrival. The app records an explicit Show or scheduled reveal without substituting Printify's creation time. Ordinary republishing preserves the product's arrival history. Unknown timestamps stay unknown rather than being invented.

### The Design of the Week

The owner selects individual published products under **Products**. The schedule is stored in `commerce.product_week_schedule`, distinct from artwork favorites or drafts. Hidden scheduled products require complete garments. Already-visible products keep their visibility when featured. A current feature cannot be silently removed by an editor that waited past its start time; mutation receipts describe the actual outcome.

Enable `storeConfig.features.designOfTheWeek` to expose the home section, footer link and admin scheduling controls. It starts disabled. Disabled stores skip weekly membership reads and return 404 from the scheduling API; catalog, lineup ordering and manual Show/Hide remain available. Disabling this presentation feature does not cancel existing product reveals or delete schedule history. Cancel future assignments before disabling it if those products should stay hidden. Re-enabling it resumes the saved schedule.

Configure `storeConfig.timeZone` and `storeConfig.weeklyFeature` in `src/lib/store-config.ts`. The default is Monday at 09:00 UTC; `weekday` uses Sunday = 0 through Saturday = 6. Confirm the owner's named IANA time zone and preferred cadence. Week boundaries follow that zone's wall clock across daylight-saving changes.

The Home page's `/#design-of-the-week` section intersects the current roster with visible published products and uses ordinary product cards. It expires at the next configured slot; the products remain in the shop. An empty week has no featured products. Library records, private artwork and unpublished siblings never become public merely because they share a design.

## The garment catalog

A category belongs to a Printify blueprint, so all products on that garment share its apparel profile. `commerce.shop_categories` holds per-store names, stable slugs and order. `commerce.garment_models` holds the manufacturer/model, category, Google product category, gender, age group and size system for each `(shop_id, blueprint_id)`.

The fresh baseline creates no categories or profiles. Published unknown blueprints appear under Needs setup. The database-generated `complete` field requires a category and every apparel field; a missing or unreadable blueprint is incomplete. The library's built-in Next Level 6210 color picker is a separate current limitation, not a preconfigured merchant profile.

### Writers enforce readiness; storefront membership stays separate

App Show refuses an incomplete garment with `GARMENT_INCOMPLETE`. Hidden-product scheduling applies the same gate. Hide remains available. A complete garment cannot be cleared while one of its products is shown or scheduled, and an in-use category cannot be deleted. Row locks protect these rules against concurrent edits.

Publication membership and profile readiness are separate. Recheck profiles after changing a product's blueprint in Printify: republishing an already visible product can leave it visible with a changed garment. The profile gate governs app visibility changes, while merchant feeds validate all of their required profile data independently.

### Scheduling requires ready garments

A schedule request locks every selected active product, then checks hidden products' garment completeness. Any missing/unpublished product or incomplete hidden garment refuses the entire batch. Retrying an identical assignment is idempotent. Removing a future assignment clears its pending reveal without altering current feature history.

### Adding a garment

Open **Garment models** and enter a Printify blueprint number or a Printify catalog URL. The parser accepts only valid HTTPS Printify catalog paths or numeric blueprint IDs; product-detail URLs and other hosts are refused. It extracts an ID without fetching an arbitrary pasted URL.

**Look up name from Printify** uses the configured draft token's catalog access when clicked, filling empty manufacturer/model fields. It does not run during page render. If lookup is unavailable, supply verified names manually. Choose the category and all apparel fields, save, and verify the profile before showing the product.

### Complete profiles supply the merchant feeds

Google and Meta feeds read complete per-shop profiles directly for each published snapshot's blueprint. There is no blueprint allowlist or T-shirt fallback. Missing/incomplete profiles fail the feed with `UNSUPPORTED_BLUEPRINT`; malformed values fail with `UNSUPPORTED_APPAREL`.

Publishing health checks every active published snapshot, including hidden products, so unfinished profiles produce `MERCHANT_CATALOG_INVALID` before reveal. The feeds include shown products only. Successful local validation does not establish that the taxonomy is correct or that Google/Meta approved the listings.

## Verification

Run the relevant catalog, publishing and garment tests plus repository checks. Local provider fixtures prove behavior without creating a live product. After authorized setup, compare actual published titles, USD prices, variants, public images and profiles with the intended Printify shop. Check narrow layouts, keyboard navigation and hidden-product previews. Confirm no private artwork or provider credentials reach page source, browser requests or feeds.
