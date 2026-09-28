# From approved artwork to a Printify product

Prepare, place and inspect the design yourself within the owner's instructions. Preserve approved artwork and make the result reviewable; the owner should choose a shirt, not debug a coordinate system.

## Choose the correct creation path

For an established model, use the [app draft/reconciliation workflow](admin-design-library.md#create-or-reconcile-drafts) with the exact immutable private revision and upload evidence. Reuse a verified existing model binding. A timeout or ambiguous create is a reconciliation task, not permission to create another product.

A **new empty store** has no published placement/price/size-guide donor. The agent can still use `drafts.create` with a complete explicit recipe: verify the actual blueprint/provider, supported variant IDs/colors/sizes, owner-approved prices, front placement and garment description first. Use current read-only provider catalog data and the authenticated editor to inspect placement. Register and assess the approved immutable private print revision, then create through the app so reservations, upload receipts and artwork provenance are preserved. See [the complete first-product request](admin-design-library.md#first-product-with-an-explicit-recipe).

Only the design-page button and `drafts.propose` need a published donor. Never claim an empty recipe exists or borrow another store's product. The initial supported model is Next Level 6210; verify the selected provider's live availability. A manual editor-created product remains outside an app binding until supported evidence actually establishes one; `drafts.reconcileBinding` takes an existing binding ID and cannot manufacture a missing binding. Do not use manual creation to bypass an uncertain app create.

The owner signs in and handles credentials, 2FA and system permission prompts directly. Discover the session's browser/computer tools and read current controls; no specific browser plugin is assumed.

## Prepare a new image

1. Preserve the native original and selected immutable revision. Use the exact approved print file when one exists; do not regenerate an approved design to change its size.
2. Inspect decoded dimensions, actual alpha, lettering and edge quality. A PNG extension, RGBA mode or painted checkerboard does not establish transparency.
3. Use the available image-editing tool under its instructions for requested cleanup. Protect intentional ink and enclosed negative space. Verify the result against the original; reject unintended changed geometry or text.
4. Review transparency against intended garment colors, white and black. Remove visible halos before offering colors that reveal them.
5. Establish intended physical dimensions and effective pixels per inch. Enlarging a raster or changing DPI metadata creates no source detail. Record native dimensions and any enlarged derivative honestly.
6. Preserve the original, prepared print file and lighter review preview separately with byte/pixel hashes and actual print assessment. Upload through the private library path and verify exact authenticated downloads.

The optional [layout helper](../scripts/artwork/prepare_print_layout.py) accepts an already-transparent file and writes a cropped PNG plus layout JSON:

```sh
python3 scripts/artwork/prepare_print_layout.py input-transparent.png output-print.png --width 8 --max-height 12
```

The numbers above only demonstrate the arguments. Choose dimensions for the owner's design and the provider's current print area. Transparent padding changes apparent placement: `visible width = editor file width × ink-bounds width / file width`. Crop or account for padding deliberately; do not force every composition into one inherited width.

Check [Printify's current file requirements](https://help.printify.com/hc/en-us/articles/4483601892497-What-dimensions-should-my-design-be). The print area is a maximum, not a target to fill. Use an adequate source or appropriate vector artwork when fine detail needs it.

## Configure and inspect the draft

Verify the actual shop before writing. Select the approved blueprint/provider and print method, then enabled colors and offered sizes. Keep required care/neck-label content intact. Use confirmed prices or the owner's delegated rule; provider default prices are not automatically the merchant's policy.

Upload the exact prepared transparent print file to the chosen print area. Inspect the flat and worn previews for collar gap, side margins, text readability and scale. Apply proportions suitable for this composition; inspect smaller/larger size previews when offered and record any unavailable views. Model photography cannot establish exact physical inches or sample quality.

For subsequent app-created drafts, `drafts.propose` names its `placementDonor`. Different valid placements among existing products are explicitly unverified. Inspect the selected reference and adjust in the provider editor if necessary before publication. Read back numeric controls after committing them; editor left/top/scale percentages differ from API image-center coordinates.

Write the design's own description while preserving verified garment, care and size-guide facts. Copying another garment's chart can produce a well-formatted lie. Use the owner's title/voice convention; do not carry a donor design's title or promotional claims.

Save as **draft**, capture the product ID, and reopen it freshly. Confirm artwork/upload identity, actual placement, variants, price, garment facts, size chart, mockups and unpublished status. Never save a stale editor tab over the owner's newer changes.

## Publish and finish only within authorization

With publication authorized, include images and follow [the artwork completion check](artwork-previews.md#product-completion-check). Verify the saved revision/fingerprint, provider acknowledgment, raw/optimized public derivative, and standalone artwork slide on the selected garment color. Use `/admin/products/<id>` for hidden products. Complete the per-store garment/category profile before showing or scheduling a new listing.

The private library's `ARTWORK_NOT_RESOLVED` guard preserves the previous snapshot when exact evidence is missing. Resolve the source and reconcile; do not disable provenance checks or add a per-product repository map. Use [bounded backfill](artwork-previews.md#repair-missing-previews-on-saved-publications) for an existing saved publication with a preview gap.

For draft-only work, report the verified draft and leave publication/gallery checks pending. Product creation does not authorize a real payment or manufacturing order. Preserve sources and operational receipts in the private library; do not commit private print masters or provider response payloads to the public template.
