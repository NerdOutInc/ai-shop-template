# Identity records and continuation

Keep the original approved portrait as the identity authority. Store its bytes unchanged and address it with a stable ID, relative asset path and SHA-256. A written description records intended or observed traits; label the distinction. Do not rewrite the original prompt to make it appear the generator followed every instruction.

## Minimum useful record

A caller-owned manifest contains `schemaVersion: 1` and a nonempty `models` array. Each model follows this record shape:

```json
{
  "id": "model-017",
  "referenceImage": "portraits/model-017.png",
  "sha256": "record-the-actual-file-sha256",
  "dimensions": [1024, 1280],
  "originalPrompt": "Retain the complete prompt actually sent.",
  "toolMetadata": { "tool": "record the actual tool", "seed": null },
  "observedTraits": "Describe visible identity features after inspection.",
  "unknowns": ["Unseen body markings and exact measurements are not established."],
  "review": { "status": "selected", "note": "Record the actual selection decision." }
}
```

The dimensions and fields above illustrate the record, not a validated asset. Read and hash the actual image. Use `referenceImage` paths relative to the manifest directory, or to an explicitly supplied asset root. IDs contain 1–64 letters, digits, hyphens or underscores and start with a letter or digit. Each ID is unique in the manifest. Do not preserve required inputs only in temporary tool-output paths.

Keep additional approved views as separate references with their own hashes and decisions. Do not overwrite an anchor with a prettier revision. A new photograph should point to the anchor ID/hash and store its full prompt, reference roles, garment evidence, generation output and continuity review. Missing seed/model-version metadata stays missing. Use `toolMetadata.tool: "unknown"` and `seed: null` when those facts were not retained; do not substitute a guess. Record an explicit limitation if the original prompt was not retained, rather than writing a new prompt as historical fact.

## A new exposure of the same person

Use this structure with the actual inspected reference:

> Create one new photograph of the same fictional adult in the identity reference. The reference establishes identity, not pose, lighting or setting. Preserve its recognizable facial proportions, apparent age, hairline/texture, body proportions and visible marks. Follow the photograph where it differs from the saved written brief. New scene: [specific moment]. Camera and framing: [plausible viewpoint]. Light: [one coherent situation]. Expression: [response to the moment]. Wardrobe references establish [exact garment/color], not a different person. Make a distinct exposure and preserve ordinary skin and fabric detail.

Do not silently add or remove marks. If the task intentionally changes hair or another visible feature, record that approved change and keep the earlier reference. The person may turn, recline, close their eyes or be partly cropped in lifestyle work; the casting inspection pose is not a permanent rule.

## Review and archive

Compare face shape, eyes/brows, nose, jaw, hairline and distinctive marks directly. Large changes in angle or expression make identity less certain; use a clearer new exposure or additional approved reference rather than claiming a text prompt proves continuity. Review body proportions as well as a face crop.

Retain the chosen original anchors, current selection manifest and prompts. Review derivatives may be regenerated. Large unselected batches can live in an explicitly chosen durable archive with hashes and a restoration procedure; a hosted gallery alone is not the source archive. Verify stored bytes before deleting the only original. This skill does not choose Git, a public bucket or a new storage service for the caller.

## Validate stored references

The bundled [validator](../scripts/validate-cast.py) needs only Python's standard library:

```sh
python3 /path/to/store-model-casting/scripts/validate-cast.py --manifest /path/to/cast.json
```

Use `--asset-root /path/to/authorized-assets` when the originals are intentionally outside the manifest directory. References must remain inside that root, including after resolving symlinks; absolute paths are rejected. The tool reads files and writes a JSON report to stdout. It does not change portraits, selection or metadata.

It checks unique IDs, required provenance/review fields, existing nonempty original files, hashes and positive recorded dimensions. PNG header dimensions are compared against the manifest. It does not fully decode images; other formats are explicitly reported as requiring a separate decoded-dimension check. Identity traits, distinctness and approval cannot be validated mechanically. A successful report confirms the manifest/anchor bytes, not the person's likeness.

Run the included focused failure checks with:

```sh
python3 /path/to/store-model-casting/scripts/validate-cast.test.py
```
