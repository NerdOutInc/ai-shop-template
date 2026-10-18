# Calibrate the merchandise once, then reuse it

## Establish the source

Use each actual product's selected-color reference and the full-resolution approved transparent artwork. Save provenance, hashes and decoded dimensions. A provider upload record may describe a large original while its preview URL returns a small derivative. Storefront thumbnails, screenshot crops and the ink baked into a mockup are references, not print masters.

Preserve the real garment's collar, sleeves, side seams, silhouette, fabric and lower edge. Verify construction from the exact style; a cropped style is not a full-length tee cut shorter. Raw-cut edges should not acquire sewn hem bands or invented fraying. A color name is not sufficient evidence of the material appearance.

For photographic garment cutouts, keep the garment pixels and restore blank fabric only inside the old printed region. Inspect repaired cloth for copied seams or smooth patches. Do not repeatedly regenerate the whole shirt to repair one incorrect hem. If using a model photograph, use garment-specific cloth coordinates, fold displacement and genuine foreground occlusion; a flat rectangle pasted onto a body is not a calibrated garment.

### Generated blank garment layers (folded or flat-lay)

Prefer the actual photographed garment as a layer. Generate a blank only when the presentation needs a construction the photo lacks, such as a folded tee. Give each reference an explicit role: the product photo of the selected color governs construction, color, fabric and collar geometry; an owner-approved presentation reference governs only the fold or arrangement style.

Ask for the blank garment alone as a true transparent cutout. Remove all existing print, text, graphics and logos, and reproduce nothing from the scene, offer or reference poster. Keep the whole garment in frame with a small margin, a fairly flat print zone and natural fabric. A folded tee tucks its sleeves and sides under the front panel and the unprinted lower portion behind, with stacked side folds, a rolled lower edge and soft edge shadows. A rectangular crop of a flat shirt is not a folded shirt. Cropped and raw-edged styles keep their real silhouette and stay unfolded.

State the visible front-panel aspect and the collar width and depth as fractions of panel width, measured from the actual product photo and the visible print length the layout needs. Verify the output against those measurements; do not reuse ratios between garments or prints. The blank is only a layer: composite the original approved artwork at measured placement using the constraints below, and retain the complete prompt, references, output hash and transform. Image generation and code-based compositing follow the active tool's opt-in rules.

## Measure independent constraints

Measure the visible ink's top, bottom, left and right relative to garment landmarks. Retain:

1. **Horizontal center:** compare the print with the local garment center at the print's height, rather than the image center, pose center or visible torso crop.
2. **Neckline gap:** record the distance from the bottom of the neck ring to the first visible ink along the cloth surface. The print should not touch the neck ring merely because a person bends forward.
3. **Scale:** use provider physical placement when available plus the same garment size, print-area dimensions and reference image. Pixel dimensions divided by DPI describe physical print size only when that DPI is the actual mapping; they do not establish position or garment scale by themselves.
4. **Lower and side clearance:** check the remaining unprinted fabric, side seams and actual print boundaries. Occlusion can hide ink but cannot justify shrinking or moving the whole design.

Draw a temporary grid over the shirt and reference: neckline baseline, garment center curve, print bounds and seam/hem landmarks. Review the overlay beside the unmarked image. These are measurements, not new artwork. If a landmark is hidden, mark that measurement uncertain and seek another reference or pose. Never treat uncertainty as a pass.

Record whether bounds refer to the complete transparent canvas or the visible alpha bounding box. Do not trim transparent margins later without updating the transform. Preserve the original aspect ratio and scale directly from the master for each export. Do not enlarge only the ink because a scene has a large empty opening.

For a flat photo cutout, keep a single authoritative source measurement. Preserve floating-point coordinates through the scene transform:

```text
inkLeftOnCutout = measuredInkLeftInPhoto - cutoutLeftInPhoto
inkTopOnCutout  = measuredInkTopInPhoto  - cutoutTopInPhoto
sceneScale     = finalGarmentWidth / cutoutWidth
heroInkLeft   = garmentLeftInHero + inkLeftOnCutout * sceneScale
heroInkTop    = garmentTopInHero  + inkTopOnCutout  * sceneScale
heroInkRight  = garmentLeftInHero + (inkLeftOnCutout + measuredInkWidth) * sceneScale
heroInkBottom = garmentTopInHero  + (inkTopOnCutout  + measuredInkHeight) * sceneScale
finalInkWidth  = heroInkRight - heroInkLeft
finalInkHeight = heroInkBottom - heroInkTop
```

Assemble the calibrated cloth and ink before applying one scale-and-translate transform to the garment. These formulas describe the resulting bounds for an unrotated cutout; do not resize or position the ink independently from them. Rotated or warped garments need the same transform applied to cloth and ink, including all four corners. Avoid separately editable duplicate offsets. Scene alignment and ink-on-shirt alignment are different operations.

If an export needs integer diagnostic bounds, quantize the transformed edges only at final rasterization using an explicit rule: `pixelEdge = floor(edge + 0.5)` (nearest integer, ties toward positive infinity). Then compute integer width as `rightPixel - leftPixel` and height as `bottomPixel - topPixel`. Do not round the offset and width separately or use a language's default `round`. For example, source left 101 and width 401 at scale 0.5 with zero translation yield edges 50.5 and 251; quantized edges are 51 and 251, so width is 200. Record the transform, rounding rule, resampling and renderer/library versions. Matching geometry across languages does not guarantee byte-identical pixels; use the same pinned renderer for exact replay.

## Keep the print photographic

Use the print method and real samples as the texture reference. DTG commonly shows the underlying knit and tiny uneven ink coverage; this is not a reason to blur the original lettering. Cloth shadows, folds and fine surface texture should affect the print consistently. Do not apply a universal distressed texture or opaque sticker layer to every product.

Review each final garment against its own original reference at native scale and phone width. Check center, collar gap, scale and clearance separately; then inspect texture, alpha edges and garment construction. A pretty scene cannot rescue a wrong product. Keep exact-file review findings with any correction, and recheck the changed output before adding it to the accepted gallery.
