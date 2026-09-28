# Website artwork previews

The storefront reads approved artwork from the saved publication snapshot. App-created or reconciled products use automatic registration. The template has no inherited artwork map. A gallery favorite or saved Printify draft does not publish an artwork preview.

## Automatic approved-artwork publication

With `ADMIN_LIBRARY_ENABLED` and its migrations configured, the [publishing worker](../src/features/publishing/process-publishing-jobs.server.ts) prepares artwork when an authorized event includes images. The [resolver](../src/features/design-products/resolve-published-product-artwork.server.ts) first checks [the immutable registry](../src/features/design-products/read-approved-product-artwork.server.ts) by shop, product and actual production fingerprint. If that exact registration is missing, it can resolve the same immutable Printify upload from existing shop-scoped upload receipts, preserving its library revision when placement changes or the upload is reused. Otherwise it compares the full source's decoded transparent PNG pixels to an exact ready library print asset. Matching requires a unique canonical design and revision, or binding/registration evidence that identifies one exact revision among identical copies. It never guesses the latest revision or records a fabricated human approval.

Before downloading a source, the resolver also checks verified saved publications in the same shop, including other products reusing the same Printify upload. It validates the saved fingerprint, pinned library revision and source hash, and unchanged upload ID and dimensions. This preserves repaired previews through image refreshes, placement edits, and reuse on another garment, including while the original product is hidden. Conflicting candidates remain unresolved. A changed upload must establish its own provenance.

The resolver refuses layered, unsupported, ambiguous or thumbnail-only evidence. A ready transparent asset can supply its exact preview independently of manufacturing-readiness assessment; generating the preview does not certify a garment placement or change library bindings. The publisher verifies the exact private print asset and [derives and hosts](../src/features/publishing/host-published-artwork.server.ts) a transparent WebP with its complete canvas and a maximum dimension of 1200 pixels and at most 75% of each source dimension. Only that derivative goes to the existing public product-image Blob store. Private native sources and print masters remain in the separate private store.

The public path is `/published-artwork/v1/<output-sha256>.webp`. The snapshot's `storefront_artwork` stores its `revisionId`, `productionFingerprint`, `src`, `width`, `height` and hashes; `storefront_artwork_enabled` must also permit display. Receipts and content-addressed uploads recover interruptions within the existing worker budget. A configuration/source/storage conflict needs operator attention; it must not fall back to a mutable latest design or expose a private master.

With the private library enabled, an image publication whose exact artwork cannot be resolved fails with `ARTWORK_NOT_RESOLVED` before activating a new snapshot. Any previous publication remains intact, and Printify receives an actionable `publishing_failed` acknowledgment. Library-disabled publishing retains its existing behavior. The guard does not make layered, unsupported, ambiguous, or thumbnail-only sources valid. Prepare/reconcile their exact source evidence before retrying an authorized publication.

[Catalog normalization](../src/features/catalog/normalize-catalog-product.ts) reads this pinned object independently of whether admin access is currently enabled. Subsequent draft changes cannot change the old snapshot's art. An invalid attached preview is hidden without reviving a stale local mapping. Confirmed provider acknowledgment updates the matching library product state; removal clears In store, and a publication without matching registered art requires reconciliation.

Bind the exact public hostname at build and runtime and allow `/published-artwork/v1/**` in image optimization. Check the saved snapshot, actual public URL, rendered card/detail preview and garment colors after an authorized publication. Fixture tests establish code behavior, not deployed storage or provider state. Mockup backfill does not populate the private artwork registry. Product bindings must have verified exact source evidence before claiming automatic matching.

## Product completion check

Create or reconcile the product through the app with its exact immutable private artwork revision and verified upload evidence. Preserve that identity when editing or reusing the artwork; do not bypass an uncertain or blocked existing app operation with a direct provider create. For a new empty store, follow the explicit first-product preparation and reconciliation path in [the product workflow](printify-workflow.md). The agent owns this workflow through the requested destination without asking the owner to discover missing registration or preview steps.

After authorized publication, verify the saved artwork pin and provider acknowledgment, then check both the raw public WebP and its optimized image response. In the real product gallery, select the final standalone artwork thumbnail and a garment color; confirm the complete image loads against that color and that color switching works. Use the public product page when visible and `/admin/products/<id>` when hidden. Preserve visibility, reveal scheduling, and order. A successful Printify callback or mockup alone does not satisfy this check.

For draft-only work, retain the same exact revision and upload provenance and verify the saved draft. Report that publication and its gallery check remain pending; do not publish to complete a test. New products should not require per-product Git changes, static preview mappings, or routine raw SQL. Use the recovery path below for already-published gaps and report unsupported source evidence precisely.

## Repair missing previews on saved publications

The [artwork backfill CLI](../scripts/printify/backfill-published-artwork.ts) inventories active published products without changing data:

```sh
node --env-file=.env.local --conditions=react-server --import tsx scripts/printify/backfill-published-artwork.ts --limit 5
```

Verify that the configured database, shop, storefront origin and Blob host identify the intended environment. Inventory reports `published` or `missing` and any pending/callback publication; it does not verify public object availability or resolve source artwork. An authorized `--apply` calls `POST /api/internal/product-artwork/backfill` on that origin using `CRON_SECRET`. The deployed route requires publishing and the private library enabled, with their database, private asset and public Blob configuration.

Each batch visits at most five products within 40 seconds. It uses the frozen published production source to resolve the exact library print revision and uploads only its bounded derivative. It never publishes current Printify draft edits, changes mockups, prices, titles, visibility or source fields, or sends a publication callback. Product locks, the saved revision and a final pending-job check protect concurrent publication. Existing enabled artwork remains unchanged.

Read each outcome: `updated` records the artwork-only history revision; `unchanged` retains the existing preview; `unmatched` needs exact source reconciliation; `partial` needs the same product retried; `skipped` needs its publication/lock/revision checked; and `failed` includes a safe `retry` or `review` disposition. Keep unresolved product IDs while advancing `--after-product-id` using `nextAfterProductId`; a completed page is not proof that every product was repaired. Retry one product with `--product-id`. A failed `cacheInvalidation` is separate from committed changes; rerunning an updated/unchanged product refreshes caches without creating another revision. Verify saved artwork, public derivative and selected-color gallery after repair.
