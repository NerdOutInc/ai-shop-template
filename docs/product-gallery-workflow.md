# Store-managed product photos

The Photos editor owns the customer-facing gallery independently of Printify. A color without a saved active selection continues to show its current Printify mockups. Once curated, that color shows exactly the selected photos, in order, across product pages, cards, checkout images and merchant listings. Republishing cannot append, replace or reorder them. The photographer gets the final say; the next Printify sync does not.

## Prepare, review, activate

1. Publish the product through the existing [Printify workflow](printify-publishing.md). Keep usable mockups selected there: publishing still validates the provider snapshot, even when the storefront will use only store photos.
2. In **Products**, open the product preview, then **Manage product photos**. Pick a color and **Choose photos for this color**.
3. Upload approved photographs, add them to their depicted color, and optionally add existing Printify photos. Uploads stay private. Use the arrow controls to order photos; the first is that color’s cover. Set descriptive alt text and role. An optional matching view such as `front` helps preserve the view when shoppers change colors.
4. **Save draft**, then **Preview draft**. Check garment, color, approved artwork, print size/placement, framing, and natural lighting. The transparent original artwork remains a separate final slide.
5. Confirm each color that needs review, then **Activate gallery**. Only this changes customers’ photos. Preparation can span several requests; “Prepared … Nothing activated yet” means select Activate again to resume. Saved immutable upload receipts prevent duplicate transfers. A failed request does not imply a successful activation: reload the saved state.
6. To restore automatic provider photos, choose **Use Printify photos**, save and activate. Saved history can be restored to a draft without immediately changing the shop.

Installing this feature activates no photos. Create and review photographs with the [portable photo skills](portable-photo-skills.md) and the [garment photography skill](../.agents/skills/store-garment-photography/SKILL.md); the Photos editor is the supported way to install the approved results. Photo originals, artwork and generation history stay in the store's private asset archive, not in Git or the web app’s upload records.

## Compatibility and recovery

Selections bind to the garment, print provider, color ID and production design fingerprints. Price/title changes, stock counts and size changes with the same print do not invalidate them. Enabling or disabling a size with a distinct production print changes the color’s set of prints and conservatively requires review. A changed artwork/placement/garment/provider marks affected curated colors **Needs review**. Their photos are withheld rather than showing the wrong shirt or reviving an intentionally removed Printify mockup. Other colors continue normally; affected feed variants are omitted. An unreadable photo URL withholds its color only. Structurally invalid manifests still withhold the full gallery because their color boundaries cannot be trusted. Feed reads log sanitized product IDs, withheld variant counts and `GALLERY_STALE` / `GALLERY_INVALID` codes for partial and full omissions. Checkout can proceed without a photo if production eligibility is valid.

Saving an unrelated change cannot approve a stale draft. Activation requires a saved draft revision, current publication revision and explicit confirmation for changed selections. Only already-stale, unchanged active selections can remain withheld while another color is activated. Draft saves and restores require the saved gallery revision; unrelated product updates do not discard captions or ordering. Only activation and new provider selections also require the current product revision. **Refresh product** preserves unsaved edits. If another editor saved a different gallery, choose explicitly whether to keep local edits over that draft or discard them. Adding or replacing a photo, or re-curating a color, requires fresh review.

Old selected provider photos remain frozen even if removed in Printify. Newly selected provider photos must already be in the configured public Blob mockup namespace; run the existing [published-image backfill](printify-publishing.md#maintenance-commands) if the editor says “Needs image backfill.” Never paste arbitrary image URLs or edit raw snapshots/SQL to install photos.

Unavailable colors retain their saved selection and cover preference, including when all their variants are disabled. Their selections are read-only until the color returns: saves and history restores reject changed captions, ordering, additions or removal. An unchanged active selection can remain dormant while other colors are saved and activated. If a color becomes unavailable during an edit, refresh the product and choose **Keep saved photos** for that color; other edits stay. For an older saved draft that already changed the unavailable color, **Restore last active selection** recovers that color alone (or removes its never-activated draft selection), then save and activate. When the color returns, its production binding is checked again before its photos reappear; a stock gap never resets it to Printify photos. The editor distinguishes **Color unavailable**, **Needs review**, and **Unavailable photos**.

A missing or changed private original, wrong-product photo, public storage conflict, or storage configuration error refuses activation with an actionable 409 naming the color/photo. Fix the indicated cause before activating again. Network failures and uncertain writes return 503; reload saved state before retrying. Logs contain only safe reason codes, never private storage paths, credentials, descriptions, or raw error payloads.

The editor reports malformed active manifests privately and fails closed publicly. Check the editor if a curated color loses its pictures; publishing health deliberately checks raw provider snapshots and cannot certify the curated selection. Hidden store products can be prepared; Printify-removed products must be republished before activation. History survives removal.

## Deployment and storage

Apply [the additive gallery migration](../supabase/migrations/20261018060023_product_galleries.sql) before deploying code. It adds private assets, gallery drafts/active manifests, append-only history and promotion receipts in `commerce`. Current administrators use authenticated same-origin API routes. Browser database roles receive no access. The migration grants `store_app_runtime` select/insert on assets, history and promotion receipts plus select/insert/update on the gallery row, each behind a `store_runtime_*` RLS policy that requires an existing product in `commerce.printify_products`. No new database pool or external service is introduced.

Required existing configuration:

- `PRINTIFY_PUBLISHING_ENABLED=true`, `DATABASE_URL`, `PRINTIFY_SHOP_ID`, and current admin authentication. Without the publishing settings the gallery API answers 503 and changes nothing.
- `PRIVATE_BLOB_READ_WRITE_TOKEN` for private photo uploads/previews.
- `BLOB_READ_WRITE_TOKEN` or Vercel OIDC with `BLOB_STORE_ID` for public promotion, with `NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST` matching that public store at both build and runtime.

Use separate preview/local data and credentials. The implementation does not run production migrations or copy existing archives automatically. Before the gallery table exists, display reads retain provider behavior so deployment ahead of migration does not interrupt checkout or the catalog. This fallback requires PostgreSQL `42P01` and confirmation that `commerce.product_galleries` is absent. Once it exists, missing dependencies, missing grants and storage errors do not restore removed provider photos. Gallery editing still requires the migration and configured storage.

Uploads accept one JPEG/PNG/WebP, up to 3 MB, at least 800 pixels on both sides and at most 40 million decoded pixels. Animated images and SVGs are refused. The server applies phone orientation, converts to sRGB, flattens transparency onto the store's theme background, strips metadata, preserves composition and produces a JPEG at most 2000 pixels on the long edge. This derivative is stored privately. Activation promotes exact verified bytes to an immutable content-addressed public path. Removing a gallery reference does **not** erase an already-public CDN URL.

A color can have 1–12 distinct photos, a product at most 80 curated colors/120 selections, and the private upload library at most 500 assets. Activation copies at most two photos concurrently within a bounded request. Draft saves/uploads do not invalidate public caches; successful activation refreshes them. A separately reported cache-refresh failure does not roll back a committed activation.

## Authenticated API for agents

Use the same current owner/admin session as the editor. There is no WebMCP adapter or new agent-token permission. All writes require a same-origin `Origin` header. Data and error responses are private/no-store. Successful private photo responses use `private, no-cache` with a content-hash ETag: browsers must revalidate current membership and product ownership before reusing bytes. Shared/CDN caching stays disabled. The first read still verifies the full photo; an authorized conditional read can return 304 without another Blob download. Never log cookies, private photo bytes or raw production snapshots.

`GET /api/admin/products/{product}/gallery` returns safe editor data: stable color keys, current binding digests, gallery/publication revisions, the saved draft, asset IDs and recent history. It does not return private Blob paths, production settings or tokens. A product with no color option uses `none`.

Upload raw image bytes to `POST .../gallery/assets` with `Content-Type` and `X-Photo-Bytes` equal to the file’s exact byte count. The result contains an asset ID and dimensions. Uploads are append-only and do not require the draft revision. Authenticated `GET .../gallery/assets/{id}` serves the private preview only for its owning product.

Send JSON of at most 128 KB to `POST .../gallery`:

```json
{
  "action": "save",
  "revision": null,
  "productRevision": "12",
  "manifest": {
    "coverColor": "10",
    "colors": [
      {
        "colorKey": "10",
        "entries": [
          {
            "source": "store",
            "assetId": "e3a4e34c-cb28-442e-8741-bef56b70b97d",
            "alt": "A model wearing the black graphic T-shirt outdoors",
            "role": "female-lifestyle",
            "viewKey": "front"
          }
        ]
      }
    ]
  }
}
```

Use the latest returned gallery `revision` on subsequent calls. Omitted colors use provider photos. A provider entry uses `source: "provider"` and `src` from this color’s offered or previously saved provider choices, instead of `assetId`. Roles are `garment`, `male-studio`, `female-studio`, `male-lifestyle`, `female-lifestyle`, or `other`. Do not send server-owned reviewed bindings, public store URLs or provenance fields; the request schema rejects them.

Activation: `{ "action": "activate", "revision": "<saved UUID>", "productRevision": "12", "confirmations": { "10": "<current binding digest reviewed>" } }`. An empty map is allowed for already-current colors. Never copy an old confirmation onto a new draft. A `preparing` result is resumable and changes no active selection; an `activated` result includes the committed revision and cache-refresh status. A 409 is a definite refusal; on an unconfirmed 503, read back before retrying.

History restore: `{ "action": "restore", "revision": "<current UUID>", "productRevision": "12", "fromRevision": "<history UUID>" }`. This restores only a draft and preserves its review binding. Saves and restores upgrade older fingerprint versions only when the exact historical source recomputes to the same current production identity; no public read writes data.

## Verification

`PRODUCT_GALLERY_TEST_DATABASE_URL` must target an isolated local `store_gallery_test` database. The database suite rebuilds only that guarded test database; never point it at a store database. Like every other database suite, CI requires it (see [CI](ci.md)); a local run without the URL skips the suite and reports incomplete database coverage rather than a pass. Run `pnpm exec vitest run --project unit src/features/product-gallery` plus checkout, merchant-feed and catalog regressions. When changing the feature, browser-check the editor at narrow/wide widths, keyboard focus, private preview and a customer color/cart journey.

## Design contracts (maintainers)

These contracts keep the gallery fail-closed. Each one protects a failure that an apparently simpler implementation would reintroduce, so change them only deliberately and with their tests.

**Outcome and boundaries.** Each published product color can move from provider photos only, through a deliberate mix of provider and store photos, to store photos only. Republishing never overwrites, reorders or revives curated photos, and unconfigured colors keep provider behavior. Provider publishing never writes the gallery tables. For example, with Color A fully curated, Color B mixed and Color C untouched, a full Printify republish leaves A and B byte-for-byte in order while C follows the new provider selection.

**One resolver at display boundaries.** [`resolveProductGallery`](../src/features/product-gallery/resolve-product-gallery.server.ts) is the only gallery algorithm. Display readers in the [publishing store](../src/features/publishing/postgres-publishing-store.server.ts) read the source snapshot and active gallery in one SQL statement through [`queryGalleryDisplay`](../src/features/product-gallery/query-gallery-display.server.ts), then apply it:

- storefront detail, cards and metadata through the cached `readRevealableProduct`, before private production data is stripped;
- the checkout line image through the gated `readProduct` behind `readCheckoutItems`, where open and paid orders keep their frozen item images;
- the gated merchant-feed path, `listShownProducts`;
- the admin display reads (`readAdminDisplayProduct`, `listAdminProducts`, `listAdminDisplayProducts`) used by the product preview, Featured order and the drop-email preview.

The worker's `getProduct`, `listProducts` for stock/backfill/health, and stored publication revisions stay raw. Apply the resolver only to images; prices, variants, print areas and production fields stay unchanged.

**Withheld-variant envelope.** The resolver returns `{ snapshot, withheldVariantIds, diagnostic, staleColors, invalidColors }`. Merchant feeds apply that resolver-owned exclusion before validation and keep it through the stock overlay, so a product whose variants are all deliberately withheld contributes no items. Do not loosen `createMerchantFeed`'s `INCOMPLETE_VARIANTS` rule: every other missing or malformed image still fails the feed, and raw publishing health stays strict.

**Server-owned review.** Each curated draft color stores a `reviewedBinding` and the publication revision it was reviewed at; clients never send it. Needs review is derived on read, never a flag written by publication. Activation takes an explicit confirmation map of color keys to the exact binding digest reviewed, and the final transaction rejects confirmations that no longer match. Adding or replacing photos, or removing and re-curating a color, resets review; reloading the page cannot approve an old draft.

**Frozen provider identity.** Provider entries are limited to the configured public host's `/published-mockups/v1/<sha256>.<jpg|png|webp>` namespace, resolved on first selection from this product's saved publication and the selected color. Later saves accept a frozen entry from this product and color's draft, active selection or history, copying provenance from server records. Reject arbitrary URLs, other products' images and unrelated colors.

**Resolver completeness.** Strip curated colors' variant IDs from provider images and drop an image left with none, so a shared provider photo cannot leak into a curated color. Mark exactly one image `is_default`: the explicit cover color, otherwise the current default color if usable, otherwise the first usable color. A null active manifest means provider behavior. An invalid non-null manifest withholds every image with a private diagnostic and never falls back to the provider. A bad photo location inside a valid manifest withholds only that color.

**Fingerprint-version continuity.** Same-version bindings compare digests directly. When the fingerprint algorithm version differs, [`isGalleryBindingCurrent`](../src/features/product-gallery/is-gallery-binding-current.server.ts) recomputes the old binding from the exact historical `printify_product_revisions` snapshot; missing history or a changed design stays Needs review. Any future algorithm upgrade must keep this path and its regression test. Saves and restores persist upgraded bindings only after proving equivalence, and public reads never write.

**Final activation safeguard.** Activation never moves a color customers can currently see, whether provider or fresh curated photos, to withheld. A newly curated or changed color without a current binding (confirmed in this request or already current) refuses the whole activation with a 409 naming that color. Only already-active, already-stale colors with unchanged entries may stay withheld without confirmation.

**Locks, receipts and deadlines.** Mutations lock the product row, then the gallery row, matching publishing lock order. Preflight the expected gallery and product revisions, then recheck them and the product's active status in the final transaction. Never hold a database client during Blob, Sharp or network work. Each public copy is a separate immutable promotion receipt, so interrupted activation resumes. Promotion runs at most two uploads concurrently within a 40-second deadline inside the 60-second route.

**Deployment-window fallback.** Only PostgreSQL `42P01`, confirmed by `to_regclass('commerce.product_galleries')` returning null, restores provider behavior. Any other error, including a different missing relation or missing grants, fails closed.

**Blend exemption.** Store photos already include their scene, so they skip the mockup multiply blend wherever it applies: shop cards, the product gallery and Featured order thumbnails. Provider mockups keep it.

**Limits.** 1–12 photos per color, 80 curated colors and 120 selections per product, 500 private assets per product, 3 MB uploads, an 800-pixel minimum edge, 40 million decoded pixels and JPEG output of at most 2000 pixels on the long edge.
