# Scheduled homepage heroes

To create new desktop/mobile concepts for a release, follow the [store-weekly-hero skill](../.agents/skills/store-weekly-hero/SKILL.md); [portable weekly hero workflow](weekly-hero-workflow.md) covers installation and this runtime's limits. This page covers the editor, upload requirements, approval and scheduling.

The weekly feature can show a separately approved desktop and mobile composition in place of the store's introductory section. It uses the existing product release schedule and `storeConfig.weeklyFeature` / `timeZone`; no extra publishing job or service is required. This feature remains off when `features.designOfTheWeek` is false. Enabling it does not enable signup, marketing or payments.

## Prepare and review

1. Schedule the intended products from **Admin → Products**. Each of the next six releases has an **Add hero** link; the current lineup has **Manage this week’s homepage hero**.
2. Upload separate compositions: a 3:1 desktop panorama at least 1800 pixels wide and a 4:7 mobile image at least 800 pixels wide. Each file must be a single PNG, JPEG or WebP, less than or equal to 3 MiB, with orientation already applied. Export high-quality images; do not shrink artwork to evade the limit.
3. Enter the design name, a useful image description, and optional offer text. The editor supplies no price, shipping or garment claims: check anything embedded in the artwork against this store's current products and configuration.
4. Choose one to six distinct scheduled products and optional available colors. The release itself may contain more products; these are the destinations pictured in the hero. Draw click areas or enter their percentage coordinates separately for desktop and mobile. Areas cannot overlap. Desktop targets must remain in the center half of the panorama, which is visible at every desktop width.
5. **Save private draft**, then open **Preview saved hero**. Resize to phone and desktop sizes. Tab through the actual product links and check their visible focus. Private preview links open admin product previews. Changes require another save before the preview link reappears.
6. With the owner's approval for the exact composition, copy and destinations, choose **Approve and schedule hero** or **Publish this week’s hero**. This is a real storefront publication action; preparing or saving a private draft does not grant that approval.

The full weekly product grid remains below an approved hero, including products not pictured in it. The hero lookup streams behind the configured introduction so it does not hold up the homepage shell.

A hero appears only during its release interval and only while every linked product is still active, visible, in that release and offers the chosen color. It expires at the next configured weekly boundary, including across daylight-saving transitions. An absent, invalid, withdrawn or unavailable hero falls back to the configured introduction and existing weekly product section. Changing the configured cadence does not rewrite stored timestamps: review queued product and hero dates before making that configuration change.

**Withdraw approved hero** revokes subsequent image requests even if products have moved or the cadence changed. Browser copies use private caching with mandatory revalidation. The server checks current eligibility before accepting a matching image ETag; a 304 avoids another private Blob download. Shared and image-optimizer caching remain disabled. Hero draft changes do not invalidate the product catalog cache. Copies already downloaded or captured by a viewer cannot be recalled. Saving an edited approved hero as a private draft also withdraws it. A stale tab cannot replace or withdraw a newer revision. If a saved composition no longer validates or its image receipt is missing, the editor retains its revision and offers replacement or withdrawal instead of treating it as a new hero.

## Private storage and access

Original hero images live in the existing private Blob store, under immutable UUID paths. Their database receipts record dimensions, byte length and SHA-256. The server checks integrity when reading bytes. Future and draft sources are never copied to public Blob storage or `public/`. Admin routes require current admin membership and same-origin mutations; disabling the weekly feature denies editor, preview and asset routes. Public routes expose only assets belonging to the current approved, eligible hero.

Upload configuration is checked before writing bytes; corrupt images are rejected as invalid input. Uploads that fail after Blob storage succeeds may leave an unreferenced private object. Do not delete assets speculatively: inspect database references and archive needs before any separately authorized cleanup. Approval is not a claim that the artwork has been fact-checked automatically.

## Schema rollout and verification

Apply [the additive hero migration](../supabase/migrations/20261017173935_weekly_hero_schedule.sql) using the store's existing migration operator after reviewing its target environment. It adds `commerce.weekly_hero_assets` and `commerce.weekly_heroes`; it does not alter prior migrations, products, schedules, owner enrollment, commerce identity or accounts.

- **Preconditions:** template baseline and incremental migrations through `20261002221459_signup_admission_health.sql`; existing `commerce` schema and restricted `store_app_runtime` role; private Blob configuration for uploads. Browser roles retain no access to these tables.
- **Compatibility:** deploy the migration before this application revision. The previous application ignores these additive tables and can run after migration. The new app falls back on public pages when storage is unavailable, but editors require the migration. Fresh installations apply the complete sequence; operating stores apply only pending migrations.
- **Locks and retry:** the migration creates two new, empty tables and policies; it does not scan or rewrite products. Apply once through migration history. On failure, verify transaction/history state before retrying; do not replay the baseline or manually mark a partial run complete.
- **Rollback:** redeploy the previous app or disable the weekly feature while retaining the private tables/assets. This does not undo authorized image downloads. Do not drop tables or delete sources as a routine rollback.
- **Verification:** confirm both tables exist, have RLS enabled, and `anon` / `authenticated` lack all table privileges. Confirm `store_app_runtime` has only SELECT/INSERT on assets and SELECT/INSERT/UPDATE on heroes. In a disposable environment, test future/draft withholding, current release eligibility, disabled routes, stale revisions and withdrawal; then test an authorized private upload/preview in the receiving environment before enabling public heroes.

Local PostgreSQL tests use `WEEKLY_HERO_TEST_DATABASE_URL` pointing to disposable `store_hero_test`. They exercise the actual restricted runtime login, an upgrade preserving an existing product, empty fresh migrations, source eligibility, shop isolation and revision guards. Mocked routes cover denial before storage access. Synthetic browser fixtures establish layout and keyboard behavior; they do not establish live Blob credentials, live admin authentication or a production release.
