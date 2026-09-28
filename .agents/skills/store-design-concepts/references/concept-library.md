# One operational design library per store

The authenticated app and Supabase database are the operational source of truth. Start at [the library guide](../../../../docs/admin-design-library.md). Use `/admin/concepts` for browsing and permanent `/admin/concepts/<number>` detail links. Collections organize explorations without restarting design numbering or replacing earlier galleries.

The template retains reusable skills, briefs and recovery tooling, and starts with an empty library. Register owner-supplied artwork through the same reviewed batch and immutable-revision workflow as generated artwork. Operational binaries belong in the store's private Blob storage with hashes and manifests, not new multi-hundred-megabyte Git batches.

## Identity and selections

- **Design ID:** immutable internal identity, with a canonical design identity for product uniqueness.
- **Permanent number:** store-wide number used by the owner. It survives collection changes and is never reused. New allocation is atomic, not a manually incremented filename.
- **Artwork revision:** immutable original, print and preview asset identities plus provenance/validation. Record ancestry for intentional remixes and retain prior revisions.
- **Favorite:** authenticated admin plus design and exact revision, unique per admin/design. Defaults to the saved revision when a newer one exists; changing it needs an explicit selection.
- **Product binding:** store/shop plus canonical design and stable model, with the actual provider product and bound revision. Hearts and title resemblance do not establish verified publication.

Personal favorites belong only to their actual administrator.

## Start or resume work

Register the requested collection/batch and exact count before generation. Claim existing work through the database reservation mechanism. Read current batch and slot state before every continuation; work already completed by another task should be recovered, not redone. Keep the grant actor and requested owner fixed; workers recheck grant validity and membership before external writes.

Review all retained designs and active work, including archived, unfavorited and rejected ideas. Save the close matches, source IDs/numbers, visual mechanisms inspected, and explicit owner feedback. Search words and hashes, then inspect images and contact sheets. Intentional remixes retain parent identity; asking for new ideas does not authorize recycling an earlier favorite.

Record progress incrementally: proposed direction, native output provenance, prepared revision, uploads, validation, comparisons and ready/pending status. Keep exact-byte and decoded-pixel duplicate checks distinct from perceptual candidates and human visual judgment. Recheck against concurrent completed work before finalizing the collection. No hash algorithm guarantees a novel joke.

## Retain and recover assets

Private Blob originals, prepared print PNGs and lighter previews have distinct asset IDs. Store decoded dimensions, source and pixel hashes, alpha/transparency results, enlargement status and intended print assessment. When original and print are byte-identical, record that fact without losing their logical roles.

Use supported upload/finalization endpoints rather than bypassing authentication or posting an entire large batch as one request. Pending uploads cannot promise successful downloads. Resolve assets by database ID through authenticated private/no-store routes; expiring URLs are retrieval mechanisms, not archival identities. Keep provider/storage credentials out of manifests.

Temporary staging may mirror `originals/`, `print/`, and `gallery/images/` for the bundled inspector. Its local manifest contract is a validation aid, not the database schema. Preserve native outputs until their private storage records, hashes and recovery paths are verified. Before removing a worktree, verify the next agent can retrieve the completed assets and read the batch state without that machine's paths.

## Inspect a private local manifest

Use [`inspect-print-assets.py`](../scripts/inspect-print-assets.py) with Python 3 and Pillow. It reads existing files and reports their decoded dimensions, hashes, alpha and optional print-target assessment; it does not generate, repair, upload or approve artwork. Keep staging and reports in an ignored private directory such as `.tmp/concept-inspection/request-01/`, outside `public/`. The `gallery/images/` name below is only a local preview folder: **do not create a replacement gallery or replace the authenticated `/admin/concepts` review and favorites workflow.**

The smallest manifest for one existing concept is `concepts.json` containing:

```json
{
  "storageKey": "request-01",
  "concepts": [
    {
      "id": "concept-01",
      "original": "originals/concept-01.png",
      "image": "gallery/images/concept-01.webp",
      "printDownload": "print/concept-01.png"
    }
  ]
}
```

`storageKey` and each unique concept `id` must be nonempty strings without surrounding whitespace. These local labels do not allocate database identities or permanent design numbers. `concepts` must be an array of objects with all four fields shown; its length must equal the positive integer passed as `--expected-count`. Use the owner's requested count for the actual batch; the one-concept example is not a generation request.

All three asset paths must identify existing local files relative to the manifest's directory. URLs, absolute paths, traversal outside that directory and symlinks that escape it are rejected. `original` and `printDownload` must decode as single-frame PNGs. The print PNG must contain both fully transparent pixels and visible artwork; the original may be opaque and may be the same file as the print PNG. Each print download must be a different file from every `image` and every other print download, including symlink/hardlink aliases. Duplicate decoded print pixels within the manifest are rejected even when PNG bytes differ. The `image` file is checked for existence and file identity, not decoded or visually assessed.

Optional assessment fields belong on each concept:

- `printDimensions`: exactly `{ "width": 3600, "height": 4800 }`, with values matching the actual decoded print PNG. Substitute the real dimensions; this example does not resize anything.
- `printSizeInches` and `targetPpi`: supply both, for example `{ "width": 12, "height": 16 }` and `300`. Width, height and PPI must be finite positive numbers, not strings or booleans, and yield finite calculated PPI. The size describes the whole canvas, not visible ink bounds.
- `printNotes`: a nonblank string is required whenever either print dimension exceeds its corresponding original dimension. Describe the actual enlargement and retained source limitation; enlargement does not create native detail.

Run from the repository root after staging the existing files and manifest:

```bash
python3 .agents/skills/store-design-concepts/scripts/inspect-print-assets.py \
  --manifest .tmp/concept-inspection/request-01/concepts.json \
  --expected-count 1 \
  --output .tmp/concept-inspection/request-01/validation.json
```

`--output` is optional; JSON is always printed to stdout. Its parent directory must already exist, and the output must not overwrite the manifest or any input asset, including file aliases. A completed inspection writes its report atomically even if individual concepts fail; an early manifest/count/output failure preserves any prior report, so always read this run's stdout and exit status.

Exit status `0` means no file-validation errors, not print approval. Confirm `inspectionComplete: true`, `inspected` equal to the requested count, an empty `errors` array and reviewed `warnings`. Omitting the print target produces a successful file check with `resolutionStatus: "not-assessed"` and a warning; below-target or enlarged-source assessments can also warn without failing. Inspect transparency, spelling, visible ink, garment-color contrast, creative similarity and print suitability yourself, then record the evidence through the app's revision and batch workflow. This report neither uploads assets nor completes that workflow.

## Return to the operational library

The public shop uses only intentionally released product mockups and approved artwork derivatives pinned to the verified publication snapshot. A mutable draft, private full-resolution master or later revision must not become public just because it appears in the admin gallery.

Use [design recovery](../../store-design-recovery/SKILL.md) for unavailable originals, partial batches, selection conflicts and uncertain provider attempts. Leave affected work pending while continuing independent resolved slots; never regenerate a favorite or retry an uncertain product create to make a missing receipt disappear.
