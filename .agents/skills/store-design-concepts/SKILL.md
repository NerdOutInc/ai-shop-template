---
name: store-design-concepts
description: Generate a requested collection of illustrated store designs, review personal favorites in the private admin gallery, and hand exact selected revisions to Printify draft creation. Use for new artwork, existing design review, or adding the owner's favorites.
---

# From an idea to favorite products

The normal workflow is **idea → private collection → personal favorites → requested product drafts**. Use this store's authenticated `/admin/concepts` library and database records. A permanent number identifies a design across collections; a favorite pins the artwork revision shown. The owner need not rename files, export browser storage, or prepare a spreadsheet. The library remembers the good ideas, even when the browser has had a long day.

Read [the app library guide](../../../docs/admin-design-library.md) for current commands and contracts. Read [library storage and reuse](references/concept-library.md) before generation and [the reusable brief](references/design-brief.md) when shaping an idea. Reusable prompt examples and local print inspection tools are bundled.

## Start at the requested step

- **“Generate 50 botanical designs”:** use the requested count, create a **new collection** for the request, register or resume its batch, inspect related work, generate distinct interpretations, and return the authenticated collection URL and permanent numbers. Never add new work to an existing collection: a collection is the record of one request, and mixing requests makes later review and recovery ambiguous.
- **Review a collection or favorites:** use the existing records. Do not generate another batch simply because this skill was invoked again.
- **“Create drafts from my favorites”:** resolve the grant's authenticated owner and their complete saved design/revision selection across collections, including favorites outside current UI filters. Each draft takes its design's own saved colors through `drafts.propose`, one request per design. Use [store-printify-product](../store-printify-product/SKILL.md); do not ask for another generation count or per-item approval.
- **“Create a Next Level 6210 draft from #149”:** resolve permanent design 149 in this store. Do not infer its source filename from the permanent number. Resolve the exact selected revision before preparing a product. The owner can also do this one themselves: **Create Printify draft** on the design's page needs no grant. Either way the draft gets the design's assigned colors. See [the one-design path](../store-printify-product/SKILL.md#one-design-the-design-pages-own-button).

If no favorites are saved, say so. An inaccessible account or unavailable saved revision is a recovery condition, not an empty selection. Use [store-admin-access](../store-admin-access/SKILL.md) for sign-in/grant issues and [store-design-recovery](../store-design-recovery/SKILL.md) for missing assets, interrupted batches, or uncertain products.

## Check capabilities and access

Generate through the repository's provider-neutral adapter, `pnpm imagegen`, described in [image generation](../../../docs/image-generation.md). Its `host` route hands the exact prompt to whatever image tool the current host offers (Codex and ChatGPT ImageGen, or another host's tool) and hashes the saved files; its `openai` and `gemini` routes call a paid API only with the owner's authorization. No image provider or key is bundled or automatically paid for by this template; read the host's current image-tool instructions when using the host route. Use the scoped app grant for library work and draft requests; check its store, owner, expiry, and allowed scope. Normal generation uses the batch review flow. Weekly features select individual published products in **Products**, after publication in Printify. Creating a Printify draft from the library does not schedule or publish it. See [featuring a design as an agent](../../../docs/admin-design-library.md#featuring-a-design-as-an-agent). Do not substitute broad Supabase/Printify credentials or put a grant in chat, Git, a URL, or a journal.

Use the authenticated app gallery for review and favorite handoff. Private artwork stays behind its access checks.

Node and Python 3 with Pillow support local validation. They do not generate images, upload into the authenticated library, or establish private publication by themselves. When a required capability or deployment is unavailable, preserve completed work and report the exact pending step; do not silently substitute a public Site for private app delivery.

## Review existing work before generating

Search every retained design, collection, prompt, mechanism and relevant owner feedback, including unfavorited, archived, rejected, used, and currently generating work. Inspect related previews and native files; a new title or file hash does not establish a new idea. Include the store’s [print records](../../../assets/print/README.md) and unfinished current operations. The template starts with an empty library.

Record close matches, compositions and jokes to avoid, and any explicitly requested remix ancestry. Claim the existing batch/slots through database reservations before generating; Git branches and past chats are context, not work locks. Resume completed slots after an interruption rather than generating them again. Missing prior artwork leaves the comparison incomplete; recover it or record that limitation.

## Resolve the brief and print target

Resolve the exact count before planning or generating. If the generation request omits it, ask one concise count question; an example count in this skill is not a commission or a default. Reuse existing brand wording, theme, delegation and product choices. Ask only for missing decisions that affect this task. Owner-supplied approved artwork can go directly to preparation without generation.

Use the owner's selected art direction. Offer flat illustration, expressive lettering or other print-suitable treatments when the direction is open; do not inherit another store's theme or visual taste. Vary composition and creative mechanism while keeping the requested idea recognizable. Deliver standalone printable artwork rather than photographed shirts/models or baked garment backgrounds unless those are the requested deliverable. Full color, limited palettes and single-color art are valid. Preserve exact brand spelling and approved geometry.

For supplied references, inspect the actual work before prompting. Borrow mechanisms such as genre collision or visual reversal, not a particular artist's composition. [Threadless](https://www.threadless.com/) and its [parody collection](https://www.threadless.com/parody/) are optional inspiration examples, not mandatory themes or assets to import.

Start with the supported Next Level 6210 (blueprint 1317), provider 99 profile for assigned design colors unless a separately assessed explicit recipe is requested. The per-design color picker does not support arbitrary providers. Verify current availability, printing method, print areas and actual offered garment colors. Mark provisional colors as provisional. Check current [Printify dimensions guidance](https://help.printify.com/hc/en-us/articles/4483601892497-What-dimensions-should-my-design-be) and Product Creator requirements before choosing the print target.

A design can use **up to five garment colors**, chosen from the real palette in [`src/features/design-library/garment-colors.ts`](../../../src/features/design-library/garment-colors.ts). Choose colors the artwork actually reads well on: judge the rendered transparent art against each candidate, not the palette name. Keep enough contrast for the darkest and lightest ink, and prefer colors already offered on a related published product so the store stays coherent. A design already bound to a Printify product takes that product's offered colors instead of a fresh guess. Record the choice with the `design.colors` agent command; the owner can promote any other color from the detail page afterwards.

Record intended whole-canvas inches, target PPI, and visible-ink size separately. For example, 12 × 16 inches at 300 PPI needs 3600 × 4800 pixels; that arithmetic is not a universal garment print area. Native source detail, decoded dimensions and alpha determine the assessment; DPI metadata or enlargement alone cannot make a small image suitable for a large print.

## Generate and retain exact artwork

Plan each requested slot with a stable batch identity, title, family, visual mechanism, exact text, suitable garment colors and a self-contained prompt. Generate between `slot.claim` and `slot.register`: write one request file per slot under ignored staging with the slot's prompt, `background: "transparent"`, the intended size and a `baseName` carrying the batch and slot, then run `pnpm imagegen --input <file>`. Use the host route when the host has an image tool; a paid route needs `--authorized-by-owner` from the active conversation or a saved `delegation.imageGeneration.paidApi` delegation, and a large requested count does not authorize switching to a paid API. Dry-run a paid batch first and show the owner count, size, quality and model. Keep each `<baseName>.receipt.json` beside its native original; its hashes, prompt, provider and model are the slot's provenance. Inspect an early representative output's actual dimensions and alpha before scaling the approach.

Preserve native originals. Retain retries as provenance without counting them as additional delivered concepts. Store approved print derivatives and previews as separate asset records belonging to an immutable artwork revision. A revision may share original/print bytes only when the unchanged original actually meets the contract. Keep enlargement, alpha validation, intended size, hashes and limitations explicit. Follow current image-editing rules for any repair; local scripts do not override those instructions.

**Every design ships a high-resolution transparent print master.** Generate the artwork on transparency, or cut the matte out during preparation and record the method; the app never removes a background, so whatever is uploaded is what the library and Printify get. The library derives its small, medium and large browsing copies from that master on request, which is the only reason a card is not downloading a four-thousand-pixel file. A print asset without validated alpha gets no browsing sizes and no garment-color preview, so an opaque upload silently costs the design both. Confirm alpha on the decoded bytes, not on the file extension or the generator's promise.

For artwork that already exists on a flat matte, `scripts/artwork/prepare-transparent-prints.mjs` removes it locally and writes contact sheets on a light and a dark garment. Look at both before uploading anything: matte-coloured ink is invisible to every colour metric, so a dark illustration on a dark backdrop loses its shading while the numbers report success. Upload the reviewed results with `revision.prepare` and `revision.upload`.

Inspect spelling, complete canvas, intended interior ink, letter counters, visible-ink bounds, stray pixels and edge fringes on light, dark and intended garment colors. Use contact sheets plus full-size inspection of suspicious work. Preserve rejected directions and supplied reasons so later agents can learn from them; lack of a favorite is not a rejection.

Compare source-byte and decoded-pixel hashes against prior work. Review perceptual matches and actual neighboring images to catch resized, cropped or closely repeated work; repeat the comparison against designs added while this batch ran. Replace rejected duplicates until the requested distinct count is delivered. Mechanical checks can reject exact repeats; visual judgment is still needed for creative similarity and physical print quality.

## Deliver a private collection

Follow the [agent command sequence](../../../docs/admin-design-library.md#agent-commands): inspect each native/print/preview file locally, register its stable pending asset IDs with the receipt's prompt, provider and model in the design record, upload with `pnpm design-agent upload`, inspect current neighbors, record the actual visual review, and complete the exact batch. The inspected native asset's SHA-256 must equal the receipt's hash for that file; a mismatch means the bytes changed after generation. Use the app's supported asset-upload and finalization path. New native sources, print masters and review previews belong in this store's **private Blob store**, with database asset identities and recoverable manifests. Temporary outputs are staging, not the archive. Never put private masters in `public/`, the public mockup store, a Git commit, or a ChatGPT Site as an implicit delivery shortcut.

A collection is ready for review only when its promised asset records and downloads are complete. Validate downloaded bytes against recorded hashes, exact delivered count, dimensions, alpha and print limitations. An uploaded file or successful gallery render does not prove full-front print readiness. Unfinished or unavailable slots stay pending rather than becoming fabricated cards.

Exercise the real authenticated gallery: search and collection/family/model/state filters, cross-collection favorites, S/M/L density and the browsing size each one loads, garment-color previews and promotion from the detail page, permanent detail links, print and S/M/L downloads, narrow layout, keyboard and visible focus. Confirm saved revisions survive another signed-in session and another admin cannot read those personal selections. Separate fixture evidence from actual deployed access and byte verification.

Return the collection link, permanent design numbers, completed count, the garment colors recorded for each design, validation limits and any pending slots. Give the normal next action: “Save your favorites, then ask me to create their drafts, or press Create Printify draft on any one design's page.” A heart saves a revision; it does not create or publish products.

The saved colors and summary you record are no longer only for review. The design page's button and the agent's `drafts.propose` both turn those colors into the draft's actual Printify variants and the summary into the product description's own paragraph, so record colors that are real `GARMENT_COLORS` names the artwork reads well on, and write the summary as something a shopper could read. A design with no colors or no summary cannot be drafted by either path.

## Hand favorites to product creation

Record the complete owner's selected design IDs, permanent numbers and revision IDs for the operation before proposing or creating anything. Later hearts or new artwork revisions belong to a later request. Drafts in each design's own colors are one `drafts.create` per design, so the operation's saved list, not a single `favorites` selection, is what keeps the batch whole: send each request the revision ID from that list, never the one a later `drafts.propose` answers with, which follows the owner's heart as it is at that moment. Pass exact native/print hashes, decoded dimensions, alpha and size assessment, intended product model and saved merchandising choices to [store-printify-product](../store-printify-product/SKILL.md).

Use the existing canonical-design/model binding before any create. Return verified matching drafts; show revision mismatches or published-product links explicitly. Another supported model may use the artwork. A new revision, request ID, provider, color, price or expired lease must not create another listing for the same canonical design and model. Uncertain attempts remain blocked until reconciled.

Complete the authorized batch without another batch or per-product approval. Default agent grants create drafts; publication uses its separately authorized path and verified immutable artwork snapshot. Do not treat saved favorites, gallery delivery, draft creation, first store go-live, or a purchase test as interchangeable permissions or verification facts.
