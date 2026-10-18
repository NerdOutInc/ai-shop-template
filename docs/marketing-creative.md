# Garments in marketing creative

Use this guide whenever one of the store's garments appears in an ad, organic social post, concept, email image or other marketing picture. The scene can have a personality; the product still has to be the product. Scheduled homepage heroes follow the [store-weekly-hero skill](../.agents/skills/store-weekly-hero/SKILL.md) and [scheduled homepage heroes](weekly-hero-admin.md); the rules below apply to every other channel.

## Keep the garment faithful

The detailed method lives in [garment fidelity](../.agents/skills/store-weekly-hero/references/garment-fidelity.md) and the [store-garment-photography skill](../.agents/skills/store-garment-photography/SKILL.md), including its [placement review](../.agents/skills/store-garment-photography/references/placement-review.md). Read them before preparing a garment layer; do not maintain a second copy of their rules here. The minimum for any channel:

1. Identify the exact approved artwork revision, product, garment style, color and destination. Do not substitute a similar design or another garment's placement.
2. Inspect the current provider mockup for **each featured garment and color separately**, then compare the matching storefront photo. Use the admin preview at `/admin/products/<product-id>` for hidden products. If provider and published photos disagree, resolve which version customers will receive before using either.
3. Take ink only from the original high-resolution approved artwork in the private design library. A provider mockup, storefront thumbnail or reduced `print_areas` preview URL is a placement and construction reference, never the ink source, even when its record reports full upload dimensions.
4. Remove the old soft ink from a photographed garment before compositing the original artwork. Keep the measured placement: horizontal center, neckline gap, scale and lower/side clearance.
5. Adjust the marketing image to match the product, never the product to match the image. Provider settings and publication state stay unchanged.
6. **Never ask an image model to redraw an approved print or invent sharper lettering.** Generate scenery or a blank garment layer, then composite the original artwork.

Retain source photos, the original artwork hash, measured bounds, transforms and final hashes with each finished creative. A prompt saying "accurate placement" is not verification, and a digital mockup does not establish physical-sample quality.

## Folded garments

Fold a garment only when that presentation suits the creative and the style's construction. A fold is a **dimensional folded blank** with stacked side folds and a rolled lower edge; a rectangular crop of a flat photograph is not a folded shirt. Calibrate the print from the real neckline and measured placement, then confirm the visible front is long enough for the print instead of shrinking the ink.

Verify construction for the exact style: collar, sleeve ends, hems and any raw-cut edges. Do not generalize one model's construction to another. Cropped and raw-edged styles keep their actual photographed silhouette and stay unfolded. When the folded blank must be generated, follow [generated blank garment layers](../.agents/skills/store-weekly-hero/references/garment-fidelity.md#generated-blank-garment-layers-folded-or-flat-lay).

## Campaign workflow

1. Re-check the live price, shipping terms, linked color and release status before writing copy. Use values the owner supplied or the store currently shows; do not carry an offer over from an earlier campaign.
2. The owner reviews new or materially changed images and the exact copy before public use. The owner approves any new budget, budget increase or spend-cap change; routine targeting and scheduling are delegated only when the owner says so.
3. Track each creative through separate states: **draft → owner-approved → uploaded → active (or scheduled) → delivery verified**. Creating files does not upload an ad, uploading does not activate it, and an active ad has not necessarily delivered. Record platform IDs and readback evidence only after the real action happened.
4. Make one separately reviewed export per placement or aspect ratio, for example a 4:5 feed image and a 9:16 Stories/Reels image. Never automatically crop one into another.
5. Inspect every final file at native size and at phone width: print lettering, garment edges, neckline, copy readability and all four canvas edges. Keep the whole print on fabric and clear of headline, offer or badge overlays. File dimensions alone do not prove readability.

## Record each creative

Keep a small working record per campaign, one entry per creative. It is a review manifest, not a bulk-import format for an ad platform. Useful fields:

- Destination: product URL with the linked color.
- Copy: primary text, headline, description and call to action.
- Alt text for the image.
- URL parameters used on the destination link.
- Source artwork revision and hashes, plus the garment reference used for placement.
- Export file name, dimensions and placement.
- Approval status, with who approved and when.
- Publication status, following the states above.
- Optional platform readback: IDs and delivery evidence, recorded only after real use.

## Storage

Finals, generated layers, cutouts and review evidence follow the [artwork storage boundary](../assets/print/README.md): private Blob storage or ignored local staging. Do not add an ads folder of operational images to Git. Commit only permitted, non-sensitive instructions or metadata, if anything.

## Attribution and measurement

The store records only `utm_source`, `utm_medium` and `utm_campaign`; see [purchase sources and orders](order-attribution.md). Use only letters, numbers, hyphens and underscores, starting with a letter or number, up to 80 characters. A label that breaks this rule or runs longer is dropped, not truncated, so avoid ad-name macros that can expand to spaces or punctuation. Put any per-ad distinction you need in `utm_campaign`, such as `autumn_drop_feed_a`. `utm_content` and other parameters are not captured. Links that hand off through Meta Shops keep only the recognized source; campaign labels after that handoff stay unknown.

Ads do not need [Meta Pixel](meta-pixel.md) or [Google purchase tracking](google-conversions.md). Those integrations remain opt-in, and optional marketing stays disabled during store preparation. Running an ad never enables them.
