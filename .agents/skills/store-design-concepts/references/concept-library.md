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

The public shop uses only intentionally released product mockups and approved artwork derivatives pinned to the verified publication snapshot. A mutable draft, private full-resolution master or later revision must not become public just because it appears in the admin gallery.

Use [design recovery](../../store-design-recovery/SKILL.md) for unavailable originals, partial batches, selection conflicts and uncertain provider attempts. Leave affected work pending while continuing independent resolved slots; never regenerate a favorite or retry an uncertain product create to make a missing receipt disappear.
