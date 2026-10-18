# Compositor job and execution

Use [scripts/composite.py](../scripts/composite.py) after inspecting the blank, original artwork and placement. It renders a new 1200×1500 composite with the sample-calibrated-dtg-v1 treatment. It does not generate a person, infer correct placement, create an occlusion mask, or approve the result.

Use Python 3.10–3.12 for the retained Pillow/NumPy preset environment. Install the pinned dependencies from [scripts/requirements.txt](../scripts/requirements.txt) into an isolated Python environment. Keep this environment separate from the project's application or lint dependencies. Run the script from its installed skill folder with explicit job and output paths; no store repository is required.

```sh
python3 -m venv /tmp/garment-photo-env
/tmp/garment-photo-env/bin/python -m pip install -r /path/to/store-garment-photography/scripts/requirements.txt
/tmp/garment-photo-env/bin/python /path/to/store-garment-photography/scripts/composite.py --job /path/to/job.json --output /path/to/new-output-directory
```

The output directory must be new. Do not point it at original assets or an existing gallery. Rendering uses a temporary sibling directory; only a complete render is moved to the requested path. A failed attempt leaves that path available for a corrected retry. Read the actual command result and inspect the files before treating the render as complete.

## Input coordinate contract

- `schemaVersion`: `1`.
- `blank`: original blank photograph. `sourceCropBox` is `[left, top, right, bottom]` in **EXIF-transposed viewer coordinates**, before resizing. A JPEG stored as 1500×1200 with orientation 6 is measured as 1200×1500. Both the guide and renderer apply the orientation before cropping. Choose a 4:5 crop (0.5% rounding tolerance); other ratios are rejected to prevent stretching body and garment proportions. The crop is resized to the fixed 1200×1500 output before projection.
- `artwork`: the approved high-resolution transparent PNG, including its original canvas and margins. Do not substitute a thumbnail, provider mockup or previously rendered ink.
- `quad`: four corners of the **whole unbent artwork canvas** in final 1200×1500 coordinates, ordered top-left, top-right, bottom-right, bottom-left. These are not uncropped source coordinates or the bounds of only the visible ink. Each horizontal/vertical edge must point within 60° of its expected right/down direction, rejecting cyclically rotated corner lists. For more extreme camera rotation, normalize the exposure orientation and remeasure; the tool cannot distinguish an intentionally upside-down shirt from mislabeled corners.
- `targetArtworkInches`: width/height of that placed canvas from the provider evidence. This informs estimated texture density; it does not measure physical inches in the photograph or automatically position/resize the quad.
- `texturePatches.cream` and `.red`: caller-supplied raster crops of printed fabric for the preset's sampled texture channels. These names identify the preset's historical channels; sample colors are removed during texture analysis. Keep sample provenance and inspect the response on the target fabric. Do not include an entire product image as a texture patch.
- Optional `view`: `studio`, `lifestyle` (the default), or `clean`. The clean-provider treatment has gentler shading/coverage and no torso-wrap response.
- Optional `foldGuides`: points, width and amplitude in final-image pixels, with weight and response kind. Trace each guide on this exposure. The compositor's supported response kinds are `ridge` (the historical bend response), `compress` and `hinge`.
- Optional `visibilityMask`: grayscale 1200×1500 image in final coordinates, with orientation already applied. White permits ink, black hides it behind foreground material; intermediate values represent partial visibility. It is not automatically cropped or inferred from the source.

Input file paths may be absolute or relative to the job file. Resolve them to the intended caller assets; the script copies them to fixed names inside the new output directory. Optional `expectedSha256` maps input names (`artwork`, `blank`, `cream`, `red`, `visibilityMask`) to their expected hashes and rejects mismatches.

Optional `surfaceBend` describes broad curvature using `verticalFraction`, `centerV` and positive `spreadV`; these are fractions of the source artwork height/coordinate space, applied separately from local output-pixel fold guides. Use only when supported by the actual cloth shape. It does not automatically infer torso geometry. Broad bends can move the top/bottom artwork edges beyond the unbent quad; the projection mesh expands to cover them within the photograph. Artwork extending outside the photograph remains outside the delivered frame. Broad bends whose analytic vertical mapping derivative can fall to 0.2 or below are rejected; the receipt's local displacement/Jacobian metrics describe only the additional fold field, not the full perspective and broad bend.

All JSON files use UTF-8. Inputs remain copied byte-for-byte for provenance. Decoding applies EXIF orientation and converts embedded ICC profiles to sRGB before blending; untagged RGB inputs are assumed sRGB. Invalid/unsupported profiles fail with a diagnostic. Final PNG/JPEG and the placement guide embed a deterministic sRGB profile, without original EXIF metadata. Outside-ink pixel preservation is measured against the cropped/resized **normalized** blank, not its original stored RGB values. Color management and perspective resampling are expected transformations of the approved artwork; its archived source bytes remain unchanged.

Illustrative geometry only; it must be replaced with inspected measurements for the actual photograph:

```json
{
  "schemaVersion": 1,
  "view": "lifestyle",
  "blank": "inputs/blank.png",
  "artwork": "inputs/artwork.png",
  "texturePatches": { "cream": "inputs/texture-light.png", "red": "inputs/texture-mid.png" },
  "sourceCropBox": [0, 0, 1200, 1500],
  "quad": [
    [420, 550],
    [780, 550],
    [780, 950],
    [420, 950]
  ],
  "targetArtworkInches": [8.1, 9.0],
  "foldGuides": []
}
```

## Outputs

The new directory contains `full/photo.png`, `full/photo.jpg`, copied inputs and a portable `job.json`. `receipt.json` records input/output hashes, environment versions, and a `rendererFilesSha256` map covering the adapter, compositor, image/JSON helpers and pinned requirements. `engineSha256` is the SHA-256 of that map serialized with Python's `json.dumps(..., sort_keys=True)` and UTF-8. Its `rendered-awaiting-independent-visual-review` status deliberately does not approve the image. Projected-art and uint8 effective-alpha files are computational diagnostics, not additional selected photographs.

Treatment measurements include the actual outside-ink changed-pixel count, projected ink bounds, local displacement/Jacobian and visible ink fraction. `algorithmSettings` describes the configured filters, resampling, orientation and working color space; these are settings, not measured sharpness or total perimeter movement. There is no numerical certification of overall placement, texture realism or physical size.

The saved effective-alpha diagnostic quantizes fractional coverage to uint8: faint edge coverage can round down to zero while changing a final channel by one level. For exact outside-ink checks, use zero projected alpha or zero visibility-mask values; do not infer exact support from a rounded diagnostic. The receipt compares the actual composite against the normalized blank wherever its internal alpha is zero.

## Provenance and limitations

Retain the job and SHA-256 hashes of the blank, artwork, texture patches, mask, renderer and resulting files. Store provider placement evidence and the four-check visual review alongside it. Hashes identify inputs and outputs; they do not prove that the original artwork or placement was approved.

The preset varies alpha coverage to expose fabric threads/gaps and transfers the blank's lighting. It applies bounded local displacement around separately traced folds, tapering that field to zero at the unbent quad boundary. The separate broad bend may move artwork edges. Artwork receives no smoothing filter; bicubic/Lanczos resampling for projection can still affect apparent sharpness. The treatment is empirical and its texture pitch/strain response is estimated. A new textile or print method may require a reviewed adjustment rather than inheriting these settings uncritically.

Byte-identical replay requires matching renderer hashes, inputs and the pinned image environment. Earlier untagged outputs will have different encoded bytes after adding color profiles. When investigating environment changes, distinguish PNG/JPEG encoding differences from decoded-pixel differences. Validate outside-ink preservation, foreground masking and visual appearance after any renderer change; numerical mesh checks cannot certify believable fit.
