# Calibrate the merchandise once, then reuse it

## Establish the source

Use each actual product's selected-color reference and the full-resolution approved transparent artwork. Save provenance, hashes and decoded dimensions. A provider upload record may describe a large original while its preview URL returns a small derivative. Storefront thumbnails, screenshot crops and the ink baked into a mockup are references, not print masters.

Preserve the real garment's collar, sleeves, side seams, silhouette, fabric and lower edge. Verify construction from the exact style; a cropped style is not a full-length tee cut shorter. Raw-cut edges should not acquire sewn hem bands or invented fraying. A color name is not sufficient evidence of the material appearance.

For photographic garment cutouts, keep the garment pixels and restore blank fabric only inside the old printed region. Inspect repaired cloth for copied seams or smooth patches. Do not repeatedly regenerate the whole shirt to repair one incorrect hem. If using a model photograph, use garment-specific cloth coordinates, fold displacement and genuine foreground occlusion; a flat rectangle pasted onto a body is not a calibrated garment.

## Measure independent constraints

Measure the visible ink's top, bottom, left and right relative to garment landmarks. Retain:

1. **Horizontal center:** compare the print with the local garment center at the print's height, rather than the image center, pose center or visible torso crop.
2. **Neckline gap:** record the distance from the bottom of the neck ring to the first visible ink along the cloth surface. The print should not touch the neck ring merely because a person bends forward.
3. **Scale:** use provider physical placement when available plus the same garment size, print-area dimensions and reference image. Pixel dimensions divided by DPI describe physical print size only when that DPI is the actual mapping; they do not establish position or garment scale by themselves.
4. **Lower and side clearance:** check the remaining unprinted fabric, side seams and actual print boundaries. Occlusion can hide ink but cannot justify shrinking or moving the whole design.

Draw a temporary grid over the shirt and reference: neckline baseline, garment center curve, print bounds and seam/hem landmarks. Review the overlay beside the unmarked image. These are measurements, not new artwork. If a landmark is hidden, mark that measurement uncertain and seek another reference or pose. Never treat uncertainty as a pass.

Record whether bounds refer to the complete transparent canvas or the visible alpha bounding box. Do not trim transparent margins later without updating the transform. Preserve the original aspect ratio and scale directly from the master for each export. Do not enlarge only the ink because a scene has a large empty opening.

For a flat photo cutout, keep a single authoritative source measurement:

```text
inkLeftOnCutout = measuredInkLeftInPhoto - cutoutLeftInPhoto
inkTopOnCutout  = measuredInkTopInPhoto  - cutoutTopInPhoto
sceneScale     = finalGarmentWidth / cutoutWidth
scaledInkLeft  = round(inkLeftOnCutout * sceneScale)
scaledInkTop   = round(inkTopOnCutout * sceneScale)
finalInkWidth  = round(measuredInkWidth * sceneScale)
heroInkLeft    = garmentLeftInHero + scaledInkLeft
heroInkTop     = garmentTopInHero + scaledInkTop
```

The scaled offsets are relative to the resized garment; the last two lines add the garment’s scene translation for an unrotated cutout. Rotated or warped garments need the same transform applied to cloth and ink. Avoid separately editable duplicate offsets. Scale the assembled garment uniformly when positioning it in the hero. Scene alignment and ink-on-shirt alignment are different operations.

## Keep the print photographic

Use the print method and real samples as the texture reference. DTG commonly shows the underlying knit and tiny uneven ink coverage; this is not a reason to blur the original lettering. Cloth shadows, folds and fine surface texture should affect the print consistently. Do not apply a universal distressed texture or opaque sticker layer to every product.

Review each final garment against its own original reference at native scale and phone width. Check center, collar gap, scale and clearance separately; then inspect texture, alpha edges and garment construction. A pretty scene cannot rescue a wrong product. Keep exact-file review findings with any correction, and recheck the changed output before adding it to the accepted gallery.
