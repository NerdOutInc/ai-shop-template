# Rebuild a hero from its private original layers

Export a 3:1 desktop composition at least **6144px wide** and a separate 4:7 mobile composition at least **2100px wide**. Keep the lossless PNG master and a WebP upload at or below 3 MiB. The exporter never shrinks the canvas to satisfy the byte limit. The upload decoder retains its 40-million-pixel ceiling.

Use authorized asset tools to restore the selected private source package into `.tmp/weekly-heroes/NAME/` in this checkout. Keep original images in `source/`, dated provider references in `references/`, and the recipe in `composition.json`. The commands refuse packages outside this ignored staging root, tracked packages, path escapes and symlinks. They make no network requests and require no store credentials.

```sh
node scripts/artwork/export-weekly-hero-upload-packs.mjs .tmp/weekly-heroes/NAME
node scripts/artwork/verify-final-weekly-hero.mjs .tmp/weekly-heroes/NAME
```

The exporter validates hashes and decoded dimensions, composes each original print at final garment size, writes `final/desktop.png`, `final/mobile.png` and matching WebPs, then records output hashes and renderer versions. Both compositions and destination paths are checked before replacing any final. Copy the resulting package back to the existing private archive using authorized tools, restore it into a fresh staging directory, and replay it with the original working folder unavailable. The verifier writes nothing and compares every decoded PNG pixel and every WebP byte. A matching render establishes replay, not correct placement or approval.

The commands do not upload, approve, schedule or withdraw a hero. Save the inspected WebPs through the [admin workflow](weekly-hero-admin.md), then read back the saved dimensions, asset IDs, product/color choices, click regions and approval state. Keep the actual release receipt privately with the package. Replacing a hero still requires the owner's publication authority; a successful export grants none.

## Composition record

Use `schemaVersion: 1`. Each image reference has a package-relative `path`, original `width`, `height` and SHA-256. Supply actual file hashes; placeholders are rejected. Preserve any reference IDs, measurement notes, prompts and `sourceLimitations` alongside these fields. Each garment can use its own artwork, so one scene can represent distinct products.

```json
{
  "schemaVersion": 1,
  "garments": {
    "first": {
      "artwork": { "path": "source/original-ink.png", "width": 4000, "height": 5000, "sha256": "ACTUAL_FILE_HASH" },
      "blank": { "path": "source/blank.png", "width": 1000, "height": 1000, "sha256": "ACTUAL_FILE_HASH" },
      "photo": { "path": "references/provider.png", "width": 1200, "height": 1200, "sha256": "ACTUAL_FILE_HASH" },
      "photoCutoutOrigin": { "left": 100, "top": 100 },
      "photoInkMeasurement": { "bounds": { "left": 400, "top": 300, "width": 300, "height": 375 } }
    }
  },
  "compositions": {
    "desktop": {
      "background": { "path": "source/desktop.png", "width": 3000, "height": 1000, "sha256": "ACTUAL_FILE_HASH" },
      "outputWidth": 6144,
      "garments": [{ "garment": "first", "left": 1100, "top": 200, "width": 700, "angle": 0 }],
      "overlays": [],
      "webpOptions": { "quality": 94, "effort": 6 }
    },
    "mobile": {
      "background": { "path": "source/mobile.png", "width": 1200, "height": 2100, "sha256": "ACTUAL_FILE_HASH" },
      "outputWidth": 2100,
      "garments": [{ "garment": "first", "left": 100, "top": 600, "width": 1000, "angle": 0 }],
      "overlays": [],
      "webpOptions": { "quality": 94, "effort": 6 }
    }
  }
}
```

These numbers illustrate the record shape; measure every real garment independently. Bounds refer to the full original ink canvas, including transparent margins. Input orientation must already be applied. The measured height must agree with the original artwork's aspect ratio to within one source-photo pixel. Coordinates use the native background's units; increasing `outputWidth` scales the whole approved scene. Do not also multiply the stored placement coordinates.

At final rasterization the renderer quantizes both transformed edges with `floor(edge + 0.5)`, then subtracts them to obtain width/height. A uniform source transform can require slightly different integer width/height rounding; the print's independent scale is never editable. Cloth and ink rotate together. Rotation anchors the resulting layer's top-left at the recorded scene position, so a rotated legacy recipe needs visual comparison before adoption. The recorded renderer and library versions, Lanczos3 resampling and intermediate PNG conversions are required for exact replay.

An optional overlay has `source` (an image reference), `left`, `top`, `width` and optional `angle`. Optional `shadow` contains `rgb: [r, g, b]`, `blur`, `x` and `y`; distances use background units. Overlays follow the garment layers in array order. Keep lettering at sufficient native resolution. Retained scenery and baked-in type keep their existing detail limits; an enlarged background is not newly recovered detail.

## Delivery and compatibility

The template serves the selected desktop or mobile original through the existing current-eligibility route, with private browser revalidation and no shared cache. It does not use the source store's quality-90 image optimizer, which could outlive withdrawal. The local optimizer accepts public static images and the configured public logo, excluding application asset routes even for direct optimizer requests. Put other optimizable local artwork under `public/images/`; custom public logo paths remain supported.

Old saved heroes remain readable and scheduled. Minimum resolution is checked on new uploads only. No database migration or owner configuration change is required. Higher-resolution originals increase phone transfer sizes, bounded by the existing 3 MiB upload cap. Responsive resized delivery would require a separate eligibility-checked derivative design; do not silently turn on persistent optimizer caching to reduce those bytes.
