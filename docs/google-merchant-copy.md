# Reviewed Google descriptions

Google-only descriptions live in the optional application-owned `google_merchant_copy` object on the published snapshot. They do not change storefront storytelling, the SEO description or Meta. No migration, provider draft read, AI call, cache flush or per-product code entry is needed.

A version-1 record contains one plain-text `content`, explicit `origin` (`generated` or `human`), `shared_facts_hash`, and explicit `reviewed_variants`. Each identity contains `id`, production-parser `fingerprint`, parser `label`, exact `color` and `size`. Optional `pattern` applies to covered variants; optional `materials` maps exact reviewed colors to verified material text. Percentages in shared prose must be verified for **every covered variant**. An edit or human approval retains known generated origin. Unknown historical origin requires evidence, never a guessed label.

Google emits generated text only as `g:structured_description` with nested `g:digital_source_type=trained_algorithmic_media` and `g:content`. Human text uses `g:description`. Each final description appends ` Color: <exact catalog color>. Size: <exact catalog size>.` No competing description is emitted for generated copy. Meta ignores the metadata.

The resolver checks the exact emitter's Unicode-point limits and XML legality: final description 1–5,000, pattern 1–100, material 1–200. Stored invalid, unsupported or stale metadata falls back to the published description; it does not omit an item or add an issue to publishing health. Shared normalized title/description or garment gender/age drift disables all reviewed variants. Per-variant production fingerprint (including its version), parser label or color/size drift disables that variant. New variants fall back; unchanged reviewed siblings retain their copy. Prices, availability, image hosting and ignored provider metadata do not invalidate review.

## Maintenance

Use a verified connection to the intended database, with its existing TLS configuration. Keep credentials and private approval files out of Git and command arguments. The script defaults to **read-only dry-run** and reads only saved publication snapshots.

```sh
node --conditions=react-server --import tsx scripts/printify/google-merchant-copy.ts --help
node --conditions=react-server --import tsx scripts/printify/google-merchant-copy.ts --shop-id SHOP --limit 100
```

Continue with `--after-product-id` from `nextAfterProductId` until `hasMore` is false. Each batch is bounded to 100 products. An invalid saved snapshot reports its product ID and `INVALID_SNAPSHOT`, and the audit continues. Guarded clear can remove only the optional record even when the snapshot cannot be parsed; proposed replacement copy still requires a valid snapshot. Audit output contains IDs, revisions, fixed issue/evidence codes and usable variant IDs, never description text. Missing provenance tables report `LEGACY_ORIGIN_AUDIT_UNAVAILABLE`; that incomplete audit must not be called a clean origin audit and does not block an independently reviewed pilot.

An explicitly requested owner preview may show copy and approval bindings:

```sh
node --conditions=react-server --import tsx scripts/printify/google-merchant-copy.ts --shop-id SHOP --product-id PRODUCT --preview
```

Freeze the returned current revision, shared hash and **only explicitly reviewed variant identities** into a private JSON file. The file is the copy object itself, not a whole snapshot:

```json
{
  "version": 1,
  "content": "Reviewed factual graphic and garment description.",
  "origin": "generated",
  "shared_facts_hash": "<hash from the current owner preview>",
  "reviewed_variants": [
    {
      "id": 123,
      "fingerprint": "<production parser fingerprint from the preview>",
      "label": "<exact parser label>",
      "color": "<exact catalog color>",
      "size": "<exact catalog size>"
    }
  ]
}
```

Run the proposed input through dry-run first. Invalid or overlong proposals are rejected without truncation; diagnostics expose only fixed codes. `--preview` is the only option that shows descriptions.

```sh
node --conditions=react-server --import tsx scripts/printify/google-merchant-copy.ts --shop-id SHOP --product-id PRODUCT --expected-revision REVISION --input /private/approved.json --preview
```

**Applying and clearing production copy require separate owner authorization.** Implementation or release approval does not authorize either operation. Following that authorization, add `--apply --approved` to the proposed-input command. Apply prints the committed `newRevision`; the audit rows retain their prewrite revision. Before clear, read the current revision again (publication may have advanced it), then use `--clear --apply --approved` with the same product/shop and that fresh `--expected-revision`. Do not reuse the revision from before apply.

The publishing-store writer locks the product row in one transaction, requires an active snapshot, rejects pending/callback jobs and a changed revision, and revalidates the approval against saved facts. Apply changes only `google_merchant_copy`, saves content and origin together, increments revision and appends existing revision history. Clear removes only that object under the same guards. It never restores a whole old snapshot. Hide/show and partial publication retain the record; deletion/unpublish that clears the snapshot drops it. Fresh products need fresh review. Apply and dry-run also inspect at most 101 existing revision records since the most recent null-snapshot unpublish/delete boundary. Known generated origin survives clear and human edits within that lifecycle. A bounded scan with incomplete evidence rejects human-origin proposals with `GOOGLE_COPY_PROVENANCE_INCOMPLETE`; it does not guess that unknown history is AI-generated. Unpublish/delete ends that lifecycle, so a fresh snapshot needs new explicit origin and approval.

If an inactive product or pending publication blocks an emergency clear, a **separately authorized** rollback to a previously verified compatible deployment can disable support for the optional record. Check other release changes for compatibility first. Older code ignores the optional object. The uncached feeds require no invalidation.

## Legacy-origin evidence

The source path is `build-design-recipe.ts` → `get-design-draft-services.server.ts` → Printify draft → publishing snapshot → merchant feed. The recipe copies the design summary into a dedicated description paragraph, with provider garment prose appended. An agent-created draft alone does not prove its summary was agent-written.

The bounded audit compares the **exact published HTML** to the saved draft recipe. `AGENT_DRAFT_RECIPE_MATCH_ORIGIN_UNCONFIRMED` identifies agent draft provenance only. `AGENT_GENERATED_SUMMARY_PUBLISHED` additionally requires a registered/ready generation-candidate summary matching that recipe's design paragraph, bound through the canonical design and shop/product. These are evidence for manual review; they do not relabel or mutate anything. Historical imported agent copy may have different receipts and requires additional source evidence. Absence of a match is not proof of human origin.

For known generated source descriptions, propose separately reviewed generated Google copy, retaining the website story and Meta within this task's scope. Do not silently mass-change legacy descriptions or claim the audit covers unavailable evidence.

## Pilot and release boundary

This port includes implementation and disposable test evidence only. It does not apply copy, activate feeds, deploy a store, refresh a source or verify Merchant acceptance. Existing store configuration and destination-specific activation gates remain authoritative; editing copy does not enable a disabled feed.

After the owner authorizes a receiving store's release and activation, select a small set of that store's variants. Read their current IDs and signatures from its verified publication source. Use separately approved factual wording with explicit origin, and independently verified pattern/material facts. Do not reuse another store's IDs, prose, garment blends, prices or approval records.

Compare a fresh complete baseline's item IDs/counts, exact Google XML and byte-identical Meta output. Let the daily source fetch run, or trigger it only if authorized. Read back the exact pilot items, recognized description/pattern/material and diagnostics. Inspect uncovered siblings in the same group for new pattern/material consistency warnings. If warnings occur, perform an authorized guarded clear, then retry the approved description without optional pattern/material and recheck the whole group. Stop at verified import without new data errors. Approval and impressions remain separate observations; expansion requires pilot acceptance and reviewed remaining facts/copy.

Sources: [Google description and XML](https://support.google.com/merchants/answer/6324468?hl=en), [pattern](https://support.google.com/merchants/answer/6324483?hl=en), [material](https://support.google.com/merchants/answer/6324410?hl=en).

## Private Google copy editor

Current active admins can use **Google copy** beside a shown product in the Products lineup, or open a hidden product's **Preview product** link. The editor lives on `/admin/products/[id]`, separate from the shared storefront presentation. This app has no separate owner role: technical admin access does not replace the owner's separate authorization for production Apply. Implementation, merge or deployment approval never authorizes a person or an agent to click Apply. Agents must obtain explicit production activation authorization independently.

With no saved record, wording and variant coverage start empty. A valid saved record retains its wording even when stale; only identities that resolve exactly today start selected. Changed, disabled, removed, new or unusable variants show reasons and need fresh review. A malformed record blocks the editor rather than overwriting unknown metadata. Recovery uses the existing separately authorized maintenance path above; the UI has no Clear operation.

Choose one shared Google-specific base wording and its origin, then select exact variants. Changing saved human-origin wording resets the human attestation and requires an explicit new origin choice. Known generated origin stays generated after human edits. Incomplete bounded history cannot establish human-origin wording. Optional saved pattern/material values and their field presence are visible and noneditable. Every saved material color must remain represented in the selected variants; `GOOGLE_COPY_METADATA_CONFLICT` requires a revised selection or separately authorized maintenance. Never infer materials or edit the public product story as a shortcut.

**Preview Google copy** reads one coherent saved snapshot, revision, publication/job status, garment feed profile and bounded provenance in a short read-only repeatable-read transaction. It freezes the exact full copy and shows final text, origin, metadata, coverage additions/removals and the published-description fallback for uncovered enabled variants. Entirely empty coverage is refused. Preview performs no writes, provider calls, jobs, source refresh or cache flush and does not reserve eligibility for Apply.

After reviewing all descriptions, explicitly confirm owner authorization and choose **Apply Google copy**. The server checks the frozen digest's consistency and identical saved optional metadata, then passes that frozen object and exact revision to the existing guarded writer. The unkeyed digest is neither authentication nor proof of human approval. The writer remains the final authority under its existing locks; stale revisions, garment facts, identities, provenance or pending/callback work require fresh review. It never regenerates bindings or retries Apply automatically.

Edits or cancellation discard the old preview and confirmation; late responses cannot reinstate them. A successful response shows the committed `newRevision` and reloads saved state. A lost response, invalid success response or server failure means **outcome unknown**: read back saved state before another decision. Matching current saved copy proves that state, not which interrupted request saved it. Do not auto-retry. Cancel, navigation and ordinary keyboard entry do not submit Apply.

All three endpoints are private, uncached and excluded from indexing: GET/PUT `/api/admin/products/[product]/google-copy` and POST `/api/admin/products/[product]/google-copy/preview`. GET requires current admin and fetch-metadata protection, with no Origin requirement. Mutations use the existing configured same-origin policy, including preview-deployment handling, strict streamed JSON capped at 64 KiB, and publishing/target guards. Signed-out refusal runs before publishing configuration checks. Preview/Apply tests use controlled database reads with the real resolver and validator; they do not establish real SQL Apply. The unchanged publishing-store suite in its designated disposable local database covers that writer separately. The signed-out browser endpoint checks require `ADMIN_E2E` and run through the template's documented admin-browser verification. No CI job or gate was added.
