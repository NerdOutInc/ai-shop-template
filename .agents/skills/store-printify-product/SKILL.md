---
name: store-printify-product
description: Prepare approved transparent print artwork and create or edit Printify product drafts, including placement, garment colors, variant pricing, mockup review, and saved product receipts.
---

# Create a Printify product

Turn the approved design into a saved, reviewable product in the intended store. The shirt carries the joke; the product record carries the coordinates.

For “add my favorites,” use [the app-library handoff](../store-design-concepts/SKILL.md) to freeze the authenticated owner's complete personal design/revision selections across collections. For a numbered request, resolve the permanent store number; numbers belong to this store, never an unrelated archive. Read [the library guide](../../../docs/admin-design-library.md) for current scoped API/CLI commands and existing operation receipts. The selection is already supplied by that request; do not regenerate artwork or ask the owner to approve each favorite again.

Read the [asset index](../../../assets/print/README.md) and [Printify artwork workflow](../../../docs/printify-workflow.md), then the selected design's record and preparation instructions. Read [catalog behavior](../../../docs/printify-catalog.md) when the product must also appear on the website. Resolve the current merchant, shop, product, provider, and requested variants before acting. Never copy another brand's product IDs, fixed print dimensions, mask polygons, color count, or pricing defaults into a new store.

## Establish the starting state

- Start new template stores with Next Level 6210 and the owner's chosen provider/settings. Use [owner intake](../store-owner-handoff/references/owner-intake.md) for missing delegation, pricing and batch-destination choices. Another verified Printify model can use the draft adapter's supported front-art recipe. Before publishing it, extend or verify the storefront product profile, feed and shipping rules; do not assume a valid provider draft makes those live-store paths support the garment. The owner also adds that garment under Products, **Garment models** (a Printify catalog link or blueprint number, not a product link) and finishes its category and apparel details before trying to show it; the app refuses Show and drop scheduling for an unfinished garment, and a new store has none until it sets them up.
- Complete the exact authorized product batch without another batch/per-product approval. Reuse confirmed settings and delegated judgment; group genuine missing inputs and report per-product exceptions in one batch receipt. Creating a batch defaults to saved drafts until the owner sets another destination or explicitly requests publication.
- Resolve the immutable approved source and prepared print asset IDs from the exact selected artwork revision. Preserve native bytes and hashes; do not silently substitute the current/latest revision. Assets stay pending until private upload and verification complete.
- Establish the app's source registration or exact upload evidence before publication, including when reusing artwork on another garment. Use the supported draft/reconciliation workflow; a filename, thumbnail, favorite, or matching title is not proof of the published source. Preserve the exact revision and immutable upload identity. Do not bypass an uncertain or blocked existing app operation by creating or copying a provider product directly.
- For an existing product, read its fresh saved state before opening an editor. Resolve current placement, Primary mockup, colors/sizes, retail prices, and publication state. A later palette audit may supersede an earlier product README while the original placement remains valid.
- Use the user's requested browser or an available supported connector/API. Reinspect current controls instead of assuming old element IDs or coordinates. If authentication requires the user, prepare the exact destination and resume after sign-in.
- Follow the owner's saved batch destination or the request's explicit destination. Use drafts when neither establishes publication intent; do not ask again when publication was already delegated. A new store's first go-live still requires its separate approval. An existing published listing can have an unpublished draft revision.

## The first product in an empty store

No published model means no donor recipe for the UI or `drafts.propose`, but `drafts.create` accepts a complete explicit recipe. Use [the first-product request](../../../docs/admin-design-library.md#first-product-with-an-explicit-recipe): verify live provider variants and print-area support, owner-approved prices/placement and garment/care/size-guide facts, then send the exact assessed private revision through the app. This preserves reservations, upload evidence and provenance without inventing a base product. Inspect actual saved mockups and publish only within authorization. A manual editor-created product has no app binding unless supported evidence establishes one; `drafts.reconcileBinding` requires an existing binding ID. Never use manual creation to bypass an uncertain app create.

## One design: the design page's own button

For a single design, the owner needs no agent and no grant. **Create Printify draft** on `/admin/concepts/<number>` reviews first and reserves nothing, then creates an unpublished draft of the revision on screen. Point the owner there when you have no `drafts:create` grant. With one, `drafts.propose` gives you the same build, described [below](#reserve-and-reuse-the-model-binding). Read [its rules](../../../docs/admin-design-library.md#create-a-draft-from-the-design-page).

It builds its recipe rather than asking for one: the design's assigned garment colors matched by name against the provider's catalogue, in the sizes and at the per-size prices of the shop's published tee, placed where that tee prints, with the design's summary as the description's own paragraph. A garment Printify cannot make right now is named and left out. It refuses in plain words rather than guess, and each refusal has a specific fix. `drafts.propose` reports the same refusals as a proposal's `blockers`, so these fixes apply to both:

- **No assigned colors:** record them with `design.colors`, or have the owner promote colors on the detail page.
- **No summary:** the design needs one; it becomes the customer-facing paragraph, so read it as copy, not as an art note.
- **Not a prepared transparent PNG, or no finished print assessment:** prepare the revision and complete `artwork.assess`. The button never uploads a matte or a preview.
- **No published tee of the model, or the recipe is `blocked`:** the first tee of a model still goes through the starting state below; afterwards the button copies it.
- **One size sold at two prices:** settle the published tee's prices in Printify first. The button will not pick one.
- **"Printify draft access is not configured":** the deployment lacks `PRINTIFY_DRAFTS_API_TOKEN`. Use [owner handoff](../store-owner-handoff/SKILL.md) for the secret; do not substitute another Printify token.

The button shows only when the design has no product of this model, or to carry on an unfinished one (**Continue Printify draft**). Its attempts belong to the administrator's own session and record no grant. They are the same reservations an agent's are: one binding per shop, canonical design and model.

## Reserve and reuse the model binding

Call `products.recipes` first and offer only the published models it returns with an empty `blocked`. Say which values it lists as `unverified` (price always is) instead of presenting them as current. That entry's variants carry **the colors of the tee it was recovered from, not the colors assigned to the design you are drafting**. A store with nothing published yet gets an empty list; the starting state above then applies. See [featuring a design as an agent](../../../docs/admin-design-library.md#featuring-a-design-as-an-agent).

**Which path builds the recipe depends on the model the owner chose.** `drafts.propose` takes design numbers and no model. It always proposes the library's one garment model, Next Level 6210 (blueprint 1317, print provider 99), because a design's assigned colors are `GARMENT_COLORS` names and those describe only that garment from that provider. Its answer names the model in `modelLabel`, and every recipe carries its `blueprintId` and `printProviderId`.

- **The requested model is blueprint 1317 from provider 99:** build the recipe with `drafts.propose`, below.
- **Any other published model:** do not use `drafts.propose` for it, and never send its recipe. That would create a 6210 instead of the garment the owner asked for, or demand a published 6210 that is beside the point. Build that recipe from the model's own `products.recipes` entry: its variants, placement and `sizeGuideDonor`. Say plainly that the draft gets that tee's colors and not the design's assigned ones, and ask the owner first when those colors matter.

Before any `drafts.create`, confirm the recipe's `blueprintId` and `printProviderId` are the requested model's.

For a 6210, call `drafts.propose` with up to 50 design numbers. It is read-only and reserves nothing, and each proposal is the design page's own build: that design's assigned colors matched against Printify's catalogue, at the published tee's sizes, per-size prices and placement. Page through favorites 50 numbers at a time; one call reads the catalogue once for the whole page. A design whose `products` (in `library.favorites` and `library.get`) already lists a product of this model will not take a new recipe: report that product rather than proposing as if its colors could change. For each proposal:

- **`blockers` is non-empty:** there is no recipe. Apply the matching fix from the list above and propose again. Do not substitute the published tee's colors to get past it.
- **`skipped` is non-empty:** tell the owner which colors or sizes will be left out **before** you create. A binding cannot be redone for different colors, so this is the only moment the gap is still a choice. Delegated judgment covers a missing size; a design losing most of its colors is worth a sentence to the owner first.
- **Otherwise:** send one `drafts.create` for that design, with its own saved request UUID, `selection` of kind `revisions`, and the proposal's `recipe` unchanged. Take **only the recipe** from the proposal; the recipe does not depend on the revision.

**The revision comes from the operation's saved selection, not from the proposal.** For favorites, and whenever the owner named an exact revision, send the design and revision IDs you recorded when the operation started. `drafts.propose` rereads the owner's heart on every call, so a heart moved or removed since then would put revision B in a request the owner made about revision A, and with one request per design the server holds no earlier favorites snapshot to catch it. The proposal's `revisionId` is only the default for a numbered request with no saved exact revision.

One request per design is deliberate: a recipe is per-design once colors differ, and one request freezes exactly one recipe. Save each complete input before sending it. Continuing a request means repeating those identical bytes; a recipe proposed again later can differ because availability moved, and different instructions under one request id are refused.

**A `draft` result does not mean your recipe was applied.** The same status and message answer a draft this request created and one that already existed, and an existing draft's variants are never compared with the new recipe or changed by it. Read `owningRequestId` on the result:

- **It equals this request's ID:** this request's frozen recipe made the product. Report the proposal's `colors` as the colors applied, not the design's assigned list.
- **It is another ID, or `null`:** an earlier draft was reused and is exactly as it was. Say the proposal was **not** applied. Report that product's colors only after reading them from the product itself; otherwise say they were not checked. Changing them is an edit of that existing draft, within authorized scope, never a second create.

Use `drafts.create` through `pnpm design-agent request --input command.json` with the [documented selection and complete recipe](../../../docs/admin-design-library.md#create-or-reconcile-drafts). Repeat the identical input/request ID until `pending` reaches zero, and inspect per-item results even then. Use the app's draft workflow before any provider create. It reserves **store/shop + canonical design + stable product model**, freezes the requested revision and saves the intended payload/attempt before external writes. The scoped grant identifies the owner and permits draft work, not automatic publication. Do not bypass an unavailable or blocked app operation with a direct broad-key create.

Return a verified matching draft when one exists. If it uses another revision, report the requested and bound revisions; edit that existing draft only within authorized scope. For a published product, return its store link and actual published revision without treating a draft request as an update or a new listing. A newer unpublished draft can differ while the active snapshot still publishes the older revision; report both states without replacing that publication evidence. A supported different product model is allowed; another provider, color, price, request ID or artwork revision is not a second model.

Keep removed/uncertain bindings and their history. A timeout, lost response, failed receipt save or expired lease never proves no product was created. Use [design recovery](../store-design-recovery/SKILL.md) and current paginated inventory plus supported correlation/artwork/model evidence before any retry. Historical names/receipts alone are insufficient, and a requested duplicate listing cannot bypass the same-model binding; resolve an appropriate distinct supported model or explicit restoration/edit instead.

Different Printify upload IDs do not prove different artwork. Let the app reconcile exact source evidence for same-model inventory before creating; missing or uninspectable sources remain a blocker. These checks do not establish visual novelty for resized, cropped or redrawn art, and manual provider changes can still race app work. Do not bypass that limitation with title matching or a direct create.

## Prepare artwork only when needed

Reuse an approved transparent upload rather than regenerating it. If an edit is needed, follow the current image-tool instructions and the user's authorized editing method. Historical local Python recipes explain earlier assets; they do not grant permission to choose that method in a new session.

1. Inspect the source at native size. Check lettering, outlines, silhouettes, interior ink, and hardware. Distinguish intentional background elements from the backdrop to remove.
2. Inspect decoded alpha. A PNG extension, RGBA mode, or painted checkerboard does not establish transparency. Require clear exterior pixels and visible artwork; inspect enclosed letter counters and holes as well.
3. Preserve approved geometry during cleanup. For an authorized deterministic cleanup, sample the actual backdrop, protect intentional ink of similar color, remove stray specks, and decontaminate partially transparent edges. Design-specific thresholds and masks must not be reused blindly.
4. Crop transparent margins so placement dimensions describe visible ink. Use an appropriate resampler if enlargement is necessary: hard pixel art and smooth illustration need different treatment. Extra pixels or DPI metadata do not add source detail.
5. Inspect the final decoded upload on the intended garment color, white, and black. Fix visible halos or reject garment colors that reveal them. Retain the original, final RGBA PNG, preparation recipe, dimensions, file hash, and decoded pixel hash.

The existing [layout helper](../../../scripts/artwork/prepare_print_layout.py) requires already-transparent input and calculates visible dimensions. Its defaults describe a particular graphic profile, so choose width and height limits from the new product and composition. Use temporary output for review before replacing an approved derivative.

Check current [Printify print-file requirements](https://help.printify.com/hc/en-us/articles/4483601892497-What-dimensions-should-my-design-be) in the Product Creator for this garment, print area, and size. The printable area is a maximum, not a target to fill. If using Printify's editor cleanup, check its current [background-removal controls and limits](https://help.printify.com/hc/en-us/articles/4483637492497-How-can-I-remove-the-background-from-my-images); retain a reusable local transparent export when available.

## Inspect the requested draft and authorized edits

For new drafts, perform creation through the documented app operation and read back its receipt. The checks below guide payload preparation, saved-state inspection and authorized edits in the current provider UI; they do not bypass reservations.

1. Confirm the intended shop and select the requested garment blueprint, provider, printing method, and print areas. Recheck offered colors and sizes. Preserve required care-label layers and keep other print areas as requested.
2. Upload the approved transparent file, not a model mockup or opaque concept source. Match its image identity and dimensions. Select the intended color before removing the last default color; afterward inspect the complete size/color selection for residual variants.
3. Preserve aspect ratio and place the visible ink deliberately. Judge collar gap, side margins, small text, and torso scale in flat and worn previews. Centering horizontally is a useful starting point; vertically centering a tall graphic can place it too low. Commit numeric fields and read them back. When reducing width, preserve the intended top edge.
4. Inspect actual mockups for every selected color and every available relevant size view. Use realistic color preview where available. Reject muddy text, weak contrast, and visible fringe. Record unavailable size previews instead of implying they were inspected.
5. For existing-product palette changes, preserve artwork, placement, retained sizes/prices, and Primary mockup unless the request changes them. The color-edit path is generally product → Edit design → Variants and layers → Select variants; inspect the current UI if labels or layout differ.
6. Review retail prices for every newly added variant. New colors can receive provider defaults with different margins from retained variants. Keep stock availability separate from enabled selection; do not invent a missing size or remove an unavailable selected size without a reason tied to the request.
7. Apply the product name, requested description/size guide, and selected mockups. Save the product and then its draft listing as required by the current UI. Capture the product ID and reopen a fresh saved view. A clicked Save button is not a saved-state receipt.

API `x`/`y` describe image-center coordinates and API `scale` relates to placeholder width; these differ from editor left/top/scale percentages. Preserve both representations and the print area's variant IDs. See [Printify image positioning](https://developers.printify.com/#image-positioning). Never save an older editor over newer user adjustments. If navigation aborts or a control times out, inspect the current saved state before retrying.

## Record and hand off

Record new sources, prepared print uploads and previews as private library assets under an immutable artwork revision. Keep exact file hashes, preparation instructions, selected revision, model binding and verified provider receipt recoverable. The `assets/print/` guide describes any explicitly retained local source records; do not add new private masters to Git or public storage as a shortcut. Keep transient composites and experiments in ignored staging and verify durable recovery before deleting native outputs.

Repository provenance records are not manual prerequisites for activating public catalog surfaces. The template's Publish path must perform any necessary registration automatically; maintaining artwork records must not require an owner to edit the repository before publication works.

The receipt should establish:

- Intended shop/product/provider IDs and a usable product URL; final title and fresh publication state.
- Permanent design number/internal ID, exact uploaded artwork revision and private asset IDs, source/upload hashes, decoded dimensions/alpha, and saved Printify image identity.
- Print areas, editor placement, exact API placement when available, and corresponding variant assignments.
- Enabled colors/sizes, unavailable variants, intended retail prices, and preserved Primary mockup.
- Flat/worn/color preview coverage, unavailable checks, and whether a physical sample was actually reviewed.

Do not call a product unpublished when it remains Publishing, or physical print quality verified from mockups or DPI alone. Show the concrete saved preview and describe remaining limits.

For a website artwork preview, follow [the publication workflow](../../../docs/artwork-previews.md). App-created or reconciled products register their exact approved artwork and production fingerprint. During an authorized image publication, the worker verifies that immutable match, derives a transparent WebP of at most 1200 pixels and at most 75% of each source dimension from the private print asset, and pins its public URL and revision in `storefront_artwork`. Only the derivative becomes public; the native source and print master remain private. Published images and ordering require no per-product repository edit, and neither does catalog membership or feed data -- but those two wait for the reveal gate: a publish arrives hidden until the owner shows it or a scheduled reveal arrives, and both need the product's garment complete under Garment models ([the garment catalog](../../../docs/printify-catalog.md#the-garment-catalog)).

Later draft edits cannot alter that saved preview. With the private library enabled, image publication fails with `ARTWORK_NOT_RESOLVED` when the exact artwork cannot be resolved, preserving any previous published snapshot and returning an actionable failure to Printify. Do not create per-product repository mappings. Layered, unsupported, ambiguous, or thumbnail-only sources need supported preparation/reconciliation, never a guess at the latest revision or a forced `storefront_artwork_enabled` value. Mockup backfill neither creates artwork registrations nor repairs an unresolved product binding.

Carry the authorized workflow through without making the owner discover these steps. For a publication request, verify the saved snapshot's exact revision/fingerprint, provider acknowledgment, raw public derivative, and optimized image response. Then open the actual product gallery, select its final standalone artwork thumbnail, and switch garment colors to confirm the full artwork and background render together. Check the public page for a visible product and `/admin/products/<id>` for a hidden one; preserve visibility and reveal scheduling. Include narrow-layout and keyboard checks when changing gallery behavior. Missing or broken artwork means the product is still incomplete: use [publishing recovery](../store-publishing-recovery/SKILL.md), including the [existing-publication backfill](../../../docs/artwork-previews.md#repair-missing-previews-on-saved-publications). Per-product repository edits and raw SQL are not the normal workflow.

For a draft-only request, prepare and verify the same revision, upload evidence, binding, and saved provider state, then report **saved draft; not published**. Do not publish merely to exercise the gallery check; identify it as pending the owner's publication request.

For draft API recovery, use the dedicated server-side `PRINTIFY_DRAFTS_API_TOKEN`; never widen the fulfillment token or pass provider credentials to the agent. `reserved-elsewhere` returns `owningRequestId` for this owner's interrupted work. Resume that request. When the design page started it, you do not hold its frozen input and cannot repeat it: `drafts.reconcile` with that id still works, since it needs only the id, and an unfinished one is carried on by the owner pressing **Continue Printify draft**. A definitive provider rejection or invalid input before submission reports `needs-input`: repair credentials and repeat the same input, or submit corrected settings with a new UUID. Only the same owner's proven unsubmitted/rejected attempt can be superseded; an ambiguous POST remains reconciliation-only even when inventory is empty. Upload metadata mismatches preserve the unused-image receipt and permit re-upload through the same request. After a created product fails price/production readback, correct that existing product and reconcile the saved request; retain its known product ID and never create a substitute. See [the exact recovery contract](../../../docs/admin-design-library.md#create-or-reconcile-drafts).
