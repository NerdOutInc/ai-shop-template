# Compositor job and execution

Use [scripts/composite.py](../scripts/composite.py) after inspecting the blank, original artwork and placement. It renders a new 1200×1500 composite with the selected-20 treatment. It does not generate a person, infer correct placement, create an occlusion mask, or approve the result.

Use Python 3.9–3.12 for the retained Pillow/NumPy preset environment. Install the pinned dependencies from [scripts/requirements.txt](../scripts/requirements.txt) into an isolated Python environment. Keep this environment separate from the project's application or lint dependencies. Run the script from its installed skill folder with explicit job and output paths; no store repository is required.

```sh
python3 -m venv /tmp/garment-photo-env
/tmp/garment-photo-env/bin/python -m pip install -r /path/to/store-garment-photography/scripts/requirements.txt
/tmp/garment-photo-env/bin/python /path/to/store-garment-photography/scripts/composite.py --job /path/to/job.json --output /path/to/new-output-directory
```

The output directory must be new. Do not point it at original assets or an existing gallery. Read the actual command result and inspect the files before treating the render as complete.

## Input coordinate contract

- `schemaVersion`: `1`.
- `blank`: original blank photograph. `sourceCropBox` is `[left, top, right, bottom]` in that original image's pixels. Choose a 4:5 crop (0.5% rounding tolerance); other ratios are rejected to prevent stretching body and garment proportions. The crop is resized to the fixed 1200×1500 output before projection.
- `artwork`: the approved high-resolution transparent PNG, including its original canvas and margins. Do not substitute a thumbnail, provider mockup or previously rendered ink.
- `quad`: four corners of the **whole artwork canvas** in final 1200×1500 coordinates, ordered top-left, top-right, bottom-right, bottom-left. These are not uncropped source coordinates or the bounds of only the visible ink.
- `targetArtworkInches`: width/height of that placed canvas from the provider evidence. This informs estimated texture density; it does not measure physical inches in the photograph or automatically position/resize the quad.
- `texturePatches.cream` and `.red`: caller-supplied raster crops of printed fabric for the preset's sampled texture channels. These names identify the preset's historical channels; sample colors are removed during texture analysis. Keep sample provenance and inspect the response on the target fabric. Do not include an entire product image as a texture patch.
- Optional `view`: `studio`, `lifestyle` (the default), or `clean`. The clean-provider treatment has gentler shading/coverage and no torso-wrap response.
- Optional `foldGuides`: points, width and amplitude in final-image pixels, with weight and response kind. Trace each guide on this exposure. The compositor's supported response kinds are `ridge` (the historical bend response), `compress` and `hinge`.
- Optional `visibilityMask`: grayscale 1200×1500 image in final coordinates. White permits ink, black hides it behind foreground material; intermediate values represent partial visibility. It is not automatically cropped or inferred from the source.

Input file paths may be absolute or relative to the job file. Resolve them to the intended caller assets; the script copies them to fixed names inside the new output directory. Optional `expectedSha256` maps input names (`artwork`, `blank`, `cream`, `red`, `visibilityMask`) to their expected hashes and rejects mismatches.

Optional `surfaceBend` describes broad curvature using `verticalFraction`, `centerV` and positive `spreadV`; these are fractions of the source artwork height/coordinate space, applied separately from local output-pixel fold guides. Use only when supported by the actual cloth shape. It does not automatically infer torso geometry. Broad bends whose analytic vertical mapping derivative can fall to 0.2 or below are rejected; the receipt's local displacement/Jacobian metrics describe only the additional fold field, not the full perspective and broad bend.

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

The new directory contains `full/photo.png`, `full/photo.jpg`, copied inputs and a portable `job.json`. `receipt.json` records input/output hashes, renderer hash, environment versions and treatment measurements. Its `rendered-awaiting-independent-visual-review` status deliberately does not approve the image. Projected-art and effective-alpha files are computational diagnostics, not additional selected photographs.

## Provenance and limitations

Retain the job and SHA-256 hashes of the blank, artwork, texture patches, mask, renderer and resulting files. Store provider placement evidence and the four-check visual review alongside it. Hashes identify inputs and outputs; they do not prove that the original artwork or placement was approved.

The preset varies alpha coverage to expose fabric threads/gaps, preserves source sharpness and transfers the blank's lighting. It applies bounded displacement around separately traced folds while pinning the perimeter. Resampling for perspective is expected; added artwork blur is not. The treatment is empirical and its texture pitch/strain response is estimated. A new textile or print method may require a reviewed adjustment rather than inheriting these settings uncritically.

Byte-identical replay requires the pinned image dependencies. When investigating environment changes, distinguish PNG/JPEG encoding differences from decoded-pixel differences. Validate outside-ink preservation, foreground masking and visual appearance after any renderer change; numerical mesh checks cannot certify believable fit.
