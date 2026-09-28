---
name: store-design-recovery
description: Recover interrupted design batches, missing private artwork, pinned-favorite conflicts, and uncertain Printify product-draft creation without replacing approved art or creating duplicate listings. Use for library/design-to-product recovery, not paid-order fulfillment.
---

# Recover designs and product drafts

Read [the library guide](../../../docs/admin-design-library.md) and the affected batch/design/revision/operation records before changing anything. Use [admin access](../store-admin-access/SKILL.md) for role or grant failures and [order recovery](../store-order-recovery/SKILL.md) for a paid customer's fulfillment. A missing receipt is a loose hold, not a reason to jump twice.

## Recover the actual selected work

Resolve the store, grant owner, permanent design number, internal/canonical design IDs and exact revision. Freeze every requested favorite across collections, not only the cards visible under current filters. An unavailable revision or inaccessible account is not an empty selection.

Do not silently use the latest revision, regenerate approved artwork, infer a transparent print file from a mockup, or drop an unresolved favorite. Recover the exact original/print assets by immutable IDs and hashes. Retain affected items as pending while continuing independent resolved work. An explicit owner edit creates a new revision or updates the requested selection; it does not erase earlier provenance.

## Resume generation and uploads

Use `batch.status` with the recorded batch UUID and read slot/candidate receipts before generating. The [command runbook](../../../docs/admin-design-library.md#agent-commands) gives the CLI inputs. Read batch/slot reservations and verified output receipts before generating. Recover completed native files, prompts, prepared revisions and private asset records. Do not rerun an entire requested count because a worker or conversation restarted. Lease recovery must use the implemented batch rules; it is not a substitute for checking an external attempt.

Repeat the existing `upload` command with the same batch/asset IDs and exact bytes; its finalization verifies uncertain storage writes. If both upload and verification fail, use the CLI's sanitized cause: an expired temporary upload authorization needs a fresh upload attempt for the same asset; size/network/storage failures need their underlying cause resolved. Do not report ready from a failed finalization or create fresh asset IDs just to bypass a conflict. For pending or interrupted uploads, inspect the asset identity, expected hash, upload receipt and finalization status. Keep private storage separate from public product images. Reuse a verified matching upload and finalize through the supported app path. Never mark missing bytes ready, make an object public to repair access, or discard the only native staging copy before durable recovery is verified.

Rerun the appropriate count/hash/alpha checks and inspect flagged visual neighbors. Exact-byte equality, decoded-pixel equality and perceptual similarity are different findings. Missing references leave novelty review incomplete; a passing hash check does not prove distinct composition or physical print quality.

Completed batch review evidence stays immutable.

## Reconcile a product attempt before retrying

Inspect the canonical-design/model binding, frozen requested revision, intended payload, provider-attempt state and receipt. Existing same-model bindings survive new requests, new prices/providers/colors/revisions, removed products and expired leases. A supported different model remains a separate legitimate binding.

- **Verified matching draft:** return its real product link and bound revision.
- **Different bound revision:** report both revisions; edit the existing draft only within the owner's authorized scope.
- **Published product:** return its actual store link and snapshot-pinned revision. A changed unpublished draft can remain unresolved while that older publication stays valid. A draft request does not create, modify or publish another listing.
- **Removed, ambiguous or unverified record:** preserve its history and resolve it deliberately before creating anything.
- **Product-create timeout/lost response/failed receipt save:** keep Needs reconciliation and block another create, including after lease expiry.

Use `drafts.reconcile` with the saved request UUID for uncertain creation, or `drafts.reconcileBinding` with the existing library binding UUID for a stale product. These paths read provider state and update evidence; they do not create or publish a product. Use fully paginated current Printify inventory and the implementation's supported correlation evidence plus artwork/model checks. Similar titles and unverified provider records are insufficient. Do not invent a client idempotency key or an order-only API field. If an uncertain create has no unambiguous verified match, leave it blocked and explain the missing evidence; do not retry as an experiment.

App reservations cannot prevent manual provider changes. Reconcile same-model inventory using exact source evidence even when upload IDs differ. Missing source bytes leave the comparison unresolved; titles, resized/cropped artwork and visual similarity do not substitute for an exact match. Preserve completed evidence when resuming the same operation, but refresh current inventory before a new product write. Recovery does not itself authorize publication, purchases, refunds or cancellation.

### Attempts the design page started

The owner's **Create Printify draft** button makes the same reservations, as the administrator's own session: its attempt and artwork-capability rows carry a null `grant_id`. That is how to tell one from agent work; it is not a damaged record. Read [the button's rules](../../../docs/admin-design-library.md#create-a-draft-from-the-design-page).

- **The owner reloaded mid-create.** The page lost its request id. Pressing the button again finds the model `reserved-elsewhere` by this same owner and carries the earlier request on from its own frozen input. Nothing needs repair.
- **An uncertain create.** The page offers **Check Printify again**, which is `drafts.reconcile`. With a `drafts:create` grant for the same owner you may run `drafts.reconcile` yourself using the `owningRequestId` a fresh request reports. You cannot continue that request with `drafts.create`: you do not hold its frozen input, and different instructions under one request id are refused. Do not invent a matching recipe to get past that, and do not expect `drafts.propose` to recover one: it builds from today's availability, not from what that request froze.
- **The page only ever offers Continue.** The binding is `reserved`, `creating` or `needs-reconciliation`. Reconcile it; a second create is never the fix.
- **Printify could not fetch the artwork.** With no grant to revoke, the link is guarded by the administrator's own standing, read again at fetch time: active membership and a confirmed, unbanned sign-in. A membership that ended mid-upload conceals the file and the upload reports unconfirmed. Restore access through [admin access](../store-admin-access/SKILL.md), then continue the same request. Check too that `NEXT_PUBLIC_SITE_URL` reaches this deployment without a sign-in wall, as for agent uploads.
- **A plain refusal before anything was reserved** (no colors, no summary, unprepared artwork, no published tee, two prices for one size, no draft token) is not a recovery condition. Fix the named input; see [product creation](../store-printify-product/SKILL.md#one-design-the-design-pages-own-button).

For a pre-create source scan, read `blockingProductIds` and resume with the same `drafts.reconcile` request ID. The server may return it to ready only after completing that scan, with no submitted create or previously proven matching product; then continue the original create input. Once a product submission or matching candidate exists, a missing result cannot justify a new create.

## Return a usable resume point

Report resolved and pending design numbers, exact revisions, restored assets, existing/new product links and the next specific recovery step. Store durable operation receipts without provider credentials or customer payloads. Keep public previews pinned to their verified publication revision; changing a draft or repairing private storage must not replace the public artwork implicitly.

For draft API recovery, use the dedicated server-side `PRINTIFY_DRAFTS_API_TOKEN`; never widen the fulfillment token or pass provider credentials to the agent. `reserved-elsewhere` returns `owningRequestId` for this owner's interrupted work. Resume that request, or reconcile it when [the design page started it](#attempts-the-design-page-started). A definitive provider rejection or invalid input before submission reports `needs-input`: repair credentials and repeat the same input, or submit corrected settings with a new UUID. Only the same owner's proven unsubmitted/rejected attempt can be superseded; an ambiguous POST remains reconciliation-only even when inventory is empty. Upload metadata mismatches preserve the unused-image receipt and permit re-upload through the same request. After a created product fails price/production readback, correct that existing product and reconcile the saved request; retain its known product ID and never create a substitute. See [the exact recovery contract](../../../docs/admin-design-library.md#create-or-reconcile-drafts).
