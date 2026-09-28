# Operate hosted product images

Use this reference for new-store Blob setup and recovery of published images. The [publishing runbook](../../../../docs/printify-publishing.md) owns the full procedure; this reference highlights decisions that can otherwise expose drafts, skip unfinished work, or misreport crawlability. Verify the intended environment before applying changes, and reuse the current task's authorization.

## Configure the implemented pipeline

- Apply the [fresh database baseline](../../../../supabase/migrations/20260928000354_storefront_baseline.sql) to the new empty database through [Supabase CLI `db push` and verify migration history](../../../../docs/store-setup.md#database-and-tls). Retain publication receipts as the store operates; they let interrupted uploads resume.
- Connect a **public** Blob store dedicated to this store/environment. Set `NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST` to its exact hostname, such as `example.public.blob.vercel-storage.com`, without a scheme or path. See [.env.example](../../../../.env.example) and [host validation](../../../../src/lib/is-public-blob-host.ts). Preview storage/data must be separate from production.
- Configure server-side Blob SDK authentication: the runbook supports Vercel OIDC with `BLOB_STORE_ID`, or `BLOB_READ_WRITE_TOKEN` where required. Verify which binding the target deployment actually uses without exposing credentials. Installing the SDK or setting the public hostname does not authenticate uploads.
- Build and deploy with that hostname. [Next.js configuration](../../../../next.config.ts) embeds the exact host and `/published-mockups/v1/**` path into the optimizer allowlist; changing only runtime configuration is insufficient. Arbitrary custom domains are not accepted by the current Blob host validator.

Publication with images selected copies approved finished-garment mockups before activating the new snapshot. It preserves original bytes, image order, variant associations, and default image. Immutable content hashes keep unchanged images at stable URLs and give changed bytes new URLs. Do not overwrite or delete historical objects: published revisions or other records can still reference them.

The [uploader](../../../../src/features/publishing/host-published-images.server.ts) resumes from durable receipts and checks object existence before reuse. Private `source_src` retains original-source provenance and is omitted from public normalized product data. Repairing a missing object or moving stores requires source bytes matching the recorded hash; `IMAGE_SOURCE_CHANGED` needs investigation, not acceptance of today's draft image. Hide/Show and publication with images deselected preserve existing published images and do not migrate old ones.

The same authorized publication now handles registered transparent artwork through [host-published-artwork](../../../../src/features/publishing/host-published-artwork.server.ts). With the private library enabled, it matches the immutable registry to the actual production fingerprint, validates the private print bytes, and uploads only a full-canvas transparent WebP bounded to 1200 pixels under `/published-artwork/v1/<sha256>.webp`. The snapshot pins revision, fingerprint, URL and dimensions; later drafts cannot change it. The public host validator, immutable upload receipts, worker deadline and retry rules apply. Private originals/masters never become public URLs or optimizer inputs. Read [artwork previews](../../../../docs/artwork-previews.md) for exact immutable artwork publication and repair. Mockup backfill does not register private artwork or enable an unverified preview.

## Backfill an existing catalog

New stores publish through the hosted-image pipeline. If a later saved publication needs an image repair, use the [backfill CLI](../../../../scripts/printify/backfill-published-images.ts) to repair the frozen **published** images; republishing current Printify drafts can release unrelated edits.

1. Verify the target database/shop, migration state, deployed origin, Blob host and storage binding. Inventory and apply use different connections: inventory reads the local command's configured database; apply calls the configured deployment. Confirm they identify the same intended store/environment.
2. Start with the read-only inventory command from the runbook:

   ```bash
   node --env-file=.env.local --conditions=react-server --import tsx scripts/printify/backfill-published-images.ts --limit 1
   ```

   It requires `DATABASE_URL`, verified database TLS, `PRINTIFY_SHOP_ID`, and the Blob hostname. It contacts neither Printify nor Blob. `alreadyHosted` is a URL-shape count, not proof that an object exists. `blockedByPublishing` identifies pending/callback publishing work.

3. For an authorized repair, append `--apply`. The CLI uses `NEXT_PUBLIC_SITE_URL` and `CRON_SECRET` to call the [deployed route](../../../../src/app/api/internal/product-images/backfill/route.ts); it does not directly update database rows. The route requires publishing enabled, database/shop/host configuration and storage access. It processes at most five products, with at most ten new uploads per product and a 40-second batch work budget. Authorization for the scoped repair covers its ordinary bounded batches and safe continuations; do not ask again for every batch.
4. Inspect every product outcome and the separate `cacheInvalidation` result. Keep a retry list as well as the pagination cursor; advancing the cursor does not finish partial or skipped products. HTTP 200 or CLI exit zero alone is insufficient: partial/skipped outcomes can still need work.

| Result                              | Action                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `updated`                           | Images committed as a new history revision; verify the fresh public URLs.                                                 |
| `unchanged`                         | Images already match; the batch still refreshes caches to recover an interrupted earlier refresh.                         |
| `partial`                           | Retry that ID with `--product-id`; receipts retain completed uploads while the previous snapshot stays active.            |
| `skipped`                           | Inspect the product lock, active publication jobs, revision and active status before retrying.                            |
| `failed` with `disposition: retry`  | Use the safe code to resolve a transient dependency failure, then retry that ID.                                          |
| `failed` with `disposition: review` | Investigate source/content changes, storage configuration/conflict, or unknown failure before applying again.             |
| `cacheInvalidation.status: failed`  | Committed products remain committed. Rerun an updated/unchanged product to refresh caches without another image revision. |

Use `nextAfterProductId` with `--after-product-id` while `hasMore` is true; `--product-id` and `--after-product-id` are mutually exclusive. A single-product partial result still needs retry even if `hasMore` is false. Do not add blind automatic retries for an uncertain HTTP result; inspect the bounded outcome and use the idempotent recovery path.

The [backfill service](../../../../src/features/publishing/backfill-published-images.server.ts) uses product locks and revision checks, updates only images from the frozen snapshot, and never reads current Printify drafts or sends publication callbacks. Pending/callback jobs block replacement; terminal `attention` does not. A successful images-only backfill does not clear a publishing incident or acknowledge a provider lock.

## Establish completion

Verify direct public originals independently of optimized browser images. Fetch the actual hosted image URLs referenced by published product pages, feed `image_link`/additional images, and product structured data; check status, redirects, content type, decodability, color/default association, and the image host's robots rules. A page can work through Next.js optimization while its underlying feed URL still points to Printify.

The feed does not require Blob URLs or test object existence. A valid complete feed, healthy publishing monitor, or dry-run hosted count therefore cannot prove image migration or Google access. Re-read each selected product after apply, account for retries/skips/failures and cache refresh, then refresh the existing Merchant source and inspect crawling/processing/approval separately with [Merchant setup](../../store-google-merchant/SKILL.md).

Report deployment/configuration, repair counts and unresolved IDs, public image checks, and Google results as separate facts. Merged code is evidence of implementation; it does not establish that production completed these steps.
