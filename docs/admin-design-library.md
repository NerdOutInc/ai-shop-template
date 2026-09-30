# Working with the private design library

Each store has its own design library at `/admin/concepts`. Administrators can review every collection, save personal favorites across devices, inspect linked products and download artwork. The public shop remains separate. Follow [private library access](admin-auth.md) for owner setup, sign-in, roles, passkeys and private storage configuration.

## The normal owner workflow

Tell the agent:

```text
Generate exactly 12 original designs around our brand theme for our store.
Review our existing library first, keep the artwork flat and illustrated,
and add the collection to our private admin gallery.
```

The agent registers the requested work, reviews related retained designs, preserves original outputs and prepares the exact requested collection. It returns a collection link and permanent design numbers. Each detail page offers the high-resolution print file plus large, medium and small copies of it, and records actual dimensions and enlargement or print-size limitations. “Ready for review” does not mean every image can print at every garment size.

Sign in and save the hearts you want. **My favorites** opens your selections across all collections; a collection, search or product filter can narrow that view. Each favorite pins the exact artwork revision displayed. A later upload cannot silently replace it; the detail page lets you inspect another revision and explicitly save that one instead.

Each image sits on one of up to five real Printify garment colors chosen for that design, and the swatches under it switch between them. The detail page shows every color the garment is offered in and can promote one into that design's five. Saving a favorite stores the garment you were looking at, so the library reopens that combination. Colors need prepared transparent artwork: a design still on its original matte is shown as delivered and says so, because the app never removes a background. A review preview does not establish print readiness.

For one design, use **Create Printify draft** on its detail page. It first shows what it would create and reserves nothing: the design's own garment colors, in the sizes and at the prices the shop already sells, placed where the shop already prints, with the design's summary as the description's own paragraph. It names any color or size Printify cannot make right now and leaves those out. Confirming uploads the exact revision's full-resolution transparent print file and creates an unpublished draft; review its mockups and publish it in Printify. It refuses, in plain words, when the design has no assigned colors or summary, when the artwork is not a prepared transparent PNG with a finished print assessment, or when no published tee of the model exists to copy from. See [the button's rules](#create-a-draft-from-the-design-page).

For many designs at once, ask an agent:

```text
Create Next Level 6210 drafts from my favorites, using our saved
pricing, colors and placement rules.
```

Or select a permanent number directly:

```text
Create a Next Level 6210 draft from design #149.
```

The agent first asks what each draft would be, in that design's own garment colors, and tells you about any color Printify cannot make before anything is reserved. It then resolves this store's design and exact selected revision, freezes the operation's selection, and returns new, existing and unresolved products separately. It reuses your delegated choices and asks only for missing inputs that block the work. A heart alone creates nothing. Draft creation does not publish products, open Checkout or authorize a purchase test.

## What a number means

A design has an immutable internal ID and one permanent store-wide number. Collections do not restart numbering. New numbers are allocated atomically and never reused. A new store has an empty library and begins its own sequence.

This template supports new stores and fresh design batches. It does not import an older store's concepts, favorites, inventory or product receipts.

## Files, revisions and privacy

The database records collections, designs, immutable artwork revisions, asset identities, personal favorites and product bindings. Each revision preserves its native original, prepared print file and review preview separately, with decoded dimensions, byte/pixel hashes, alpha assessment, enlargement and intended print-size notes. Byte-identical original/print files can retain both roles without pretending an opaque source is transparent.

New originals, print masters and concept previews live in a **private Vercel Blob store** dedicated to this store. Browser requests use `/api/admin/assets/<asset-id>`; `?download=1` returns the same protected bytes as an attachment.

`?size=small|medium|large` returns a browsing copy instead of the master, fitted inside 480, 800 or 1440 pixels on its longest edge as lossless WebP. The gallery always asks for a size, because a print master is around 4200 × 4800 pixels and a page holds up to 48 cards. The app derives each size once with sharp and keeps it in the same private store at `concepts/<asset-id>/<source-sha256>-<size>.webp`; addressing it by the master's hash means replaced artwork can never serve a stale size, and two requests racing on a cold path produce identical bytes. Derivatives get no browser cache: `src/proxy.ts` puts `private, no-store` on every `/api/admin` response, and a derived size is still private artwork. The saving is the resize, not the transfer — a repeat visit reads the stored derivative instead of decoding a print master again.

**The app never removes a background.** A size is derived only from an asset with validated alpha, and a request for one on opaque artwork returns 404 rather than falling back to the master. Transparency is decided during preparation and uploaded, so an opaque master means the design gets no browsing sizes and no garment-color preview until it is prepared again.

Every request requires current administration and private/no-store responses. Browser asset reads verify signed Supabase claims, then check the current session, confirmed and unbanned user, admin membership and asset together in one database query. Asymmetric signing keys allow cached JWKS verification; verify the project’s current key configuration when setting up Auth. Claims alone never grant gallery access. Do not expose storage locations, send these images through the public Next.js optimizer, or copy private masters into the public mockup store.

Pending or unavailable assets are visible as such. A gallery image is not proof that its source or print download exists. Finalization must verify decoded format, dimensions and hashes before declaring an asset ready. Keep native staging files until private storage and recovery have been checked; a temporary generation URL is not an archive.

Only intentionally released mockups and approved artwork derivatives belong on the public storefront. Transparent storefront artwork must be pinned to the verified publication snapshot's exact revision and production fingerprint. Later draft revisions cannot change the art shown for an older published product. See [publishing](printify-publishing.md) and [artwork previews](artwork-previews.md) for the current implementation and rollout limits.

## Garment colors and archiving

Each design is offered in up to five garment colors from `library_design_colors`. The rows hold a name and its position; [`src/features/design-library/garment-colors.ts`](../src/features/design-library/garment-colors.ts) owns the swatch values for all 36 colors Printify offers on blueprint 1317 (Next Level 6210) through print provider 99. Storing a name rather than a hex keeps one source of truth, so a corrected swatch is a code change and a retired color stays visible as a decision to revisit.

A card shows the selected colors and hides them at Small density, where a wrapped row would cost every card about 90 pixels. The detail page shows the whole palette, previews any color, and promotes one into the five with `POST /api/admin/concepts/<design>/colors`. A design already holding five refuses a sixth with 409 rather than dropping a color the owner chose: `DELETE` removes one first, so the trade is always visible. An agent replaces the whole set with the `design.colors` command. Saving a favorite also stores the garment it was judged on, and the library reopens that combination.

`state` on a design is `active`, `archived` or `rejected`. The library shows active designs only; the Design state filter (`?state=archived`) reveals the rest, and the detail page archives or restores through `PUT /api/admin/concepts/<design>/state`. Archiving hides, it never deletes.

## Generation and concurrent agents

Use the scoped app grant to identify the administrator whose library/favorites the agent is working with. The server resolves that identity; callers cannot supply another user's ID. Grants expire and can be revoked, and active membership is checked again before new external writes. Library/draft access does not grant product publication or broad provider-account access.

Register the batch and requested count before generation. Database reservations coordinate workers and preserve completed slots after interruptions. Search all retained work, including archived, rejected, unfavorited, used and currently generating designs. Record related artwork, jokes, compositions and owner feedback that the new work must avoid; explicit remixes retain ancestry.

Reject exact repeats using source-byte and decoded-pixel hashes. Perceptual matches flag candidates for visual review; inspect related images and batch contact sheets. Recheck work added by other agents while this batch ran. These records make the review auditable, but cannot guarantee that an AI never repeats an idea. Do not call a partial batch complete or regenerate missing favorites as substitutes.

## One product per design and model

A durable binding reserves **store/shop + canonical design + stable product model** before any Printify create. Next Level 6210 and a verified hoodie model can each use the same artwork for separate drafts. Before showing another garment, verify its storefront, Merchant and shipping details and complete its profile under **Garment models** on `/admin/products`. The [merchant feeds use that saved profile](printify-catalog.md#complete-profiles-supply-the-merchant-feeds). A product on an unfinished garment can be published, but the app will not show or schedule it and publishing health flags its missing profile. Different prices, providers, colors, sizes, artwork revisions or request IDs do not permit a second listing of the same model.

A verified matching draft is returned as the existing result. If the requested revision differs, show the bound and requested revisions; do not call it fulfilled or silently modify the draft. An already published product returns its actual store link and published revision. Authorized edits update the existing binding rather than creating a duplicate. Removed or uncertain records keep their history and need deliberate restoration/reconciliation.

A product-create timeout, lost response or failed receipt save leaves creation in **Needs reconciliation**. Lease expiry is not permission to retry. Inspect paginated provider inventory and the supported correlation evidence plus model/artwork match; absent or ambiguous uncertain matches remain blocked. Direct manual Printify changes can bypass app reservations. Exact decoded-source matches must be checked across different upload IDs before creating another product; unavailable or uninspectable source leaves that check unresolved. Similar titles, crops, resizes and visually related artwork are not exact-source proof. This provider scan does not establish creative novelty or a provider-wide uniqueness guarantee; the generation workflow separately requires visual review.

## Agent commands

The owner opens `/admin/agents`, chooses a label, the required scopes and an expiry of 1–168 hours, and downloads the credential once. Generation uses `library:read` and `library:write`; product draft work also uses `drafts:create`. Weekly scheduling selects individual published products under `/admin/products`. The grant acts as that administrator, including their personal favorites. Store the downloaded credential outside Git with permissions `0600`. Set `DESIGN_AGENT_URL` to this store's exact origin and `DESIGN_AGENT_TOKEN_FILE` to that private file; `DESIGN_AGENT_TOKEN` in the process environment is an alternative. Never put a token in command arguments, chat, URLs or a generation manifest.

The pinned repository CLI sends JSON commands to `/api/admin/agent` and returns their results:

```sh
pnpm design-agent request --input command.json
```

The [command parser](../src/features/design-agent/parse-design-agent-command.ts), [library input validator](../src/features/design-library/validate-library-design.ts), and [CLI](../scripts/design-agent/run.mjs) are the exact contracts. Keep stable UUIDs and complete input files in the operation's recoverable metadata; rerunning a request uses those same identities and inputs. Do not print private response payloads into public artifacts.

### Generate and finish a collection

1. Use `library.search` with `search`, `offset`, `limit` and `pendingOffset`. Read every relevant page: returned `total` covers designs, while `pendingTotal`/`pendingDirections` cover separately paginated active work, 200 directions at a time. Include retained unfavorited, archived, rejected and used artwork. `library.get` takes `number`; `library.favorites` takes `offset`/`limit` and returns only the grant owner's favorites. Complete favorite requests must page through `total`, independent of current UI filters.
2. Send `batch.create` with a stable `requestId` UUID, `title`, `brief` and exact `count` from 1–200. Save the returned `batchId` and `collectionId`. Larger authorized requests need multiple recorded batches retaining the full requested total. The API reserves work; it does not generate images.
3. Send `batch.plan` with `batchId` and `directions`: each has a one-based `slot`, `subject`, `mechanism`, `composition`, `lettering`, `avoidDesignNumbers`, and optional `parentDesignNumber` for an intentional remix. Claim a slot with `slot.claim`, its `batchId`, `slot`, and a stable worker UUID in `workerId`. Use host-provided ImageGen only after claiming. On continuation, inspect `batch.status` and recover existing outputs before generating again.
4. Preserve the native original and prepare the transparent PNG and lighter preview. Run local inspection separately for each role:

   ```sh
   pnpm design-agent inspect --input inspect.json
   ```

   `inspect.json` contains `file`, `kind` (`original`, `print` or `preview`), honest boolean `enlarged`, and optionally the existing asset UUID `id`. This needs no account access and reads actual bytes. Save its pending asset metadata/UUID; reuse them on retries. An original and print can contain identical bytes while retaining separate role IDs.

5. Send `slot.register` with `batchId`, `slot`, `workerId`, and `design` matching `LibraryDesignInput`. Supply stable design/revision UUIDs, title/family/summary/mechanism/prompt, optional background as a value or `null`, `state: "active"`, and only the returned collection ID in `collectionIds`. The revision contains all three inspected assets and an honest unverified or needs-preparation print assessment. Omit `displayNumber`; the server allocates the permanent number. Assets must remain `pending` with `pathname`/`sourcePath` null; do not manufacture ready storage records.
6. For each registered asset run `pnpm design-agent upload --input upload.json`, where the input is `{ "batchId": "<batch UUID>", "assetId": "<asset UUID>", "file": "<exact local file>" }`. The CLI obtains a scoped temporary upload permission, uploads directly to private Blob using multipart, and asks the server to decode/hash/finalize the bytes. It does not print temporary credentials. Repeat the same upload command after interruption; finalization verifies a possibly committed upload. If upload and finalization both fail, the CLI reports a sanitized authorization, size, network or storage cause. The asset remains unconfirmed; resolve that cause and resume the same asset rather than looping on the generic service error. Do not invoke `asset.upload` through the generic request command.
7. Run `slot.inspect` with `batchId`/`slot`. It returns `candidateId`, `neighbors` and `comparisonHash`. Download and visually review flagged neighbor assets and the batch contact sheet. Send `slot.review` with the current `comparisonHash`, all actually reviewed `reviewedAssetIds`, meaningful `notes`, and `contactSheetReviewed: true` only after that inspection. If another task changes the comparison set, inspect and review again. Use `slot.reject` with `reason` for rejected candidates, retain their history, and claim that slot for a new candidate.
8. Send `batch.complete` with `batchId`. It requires the exact ready count, all promised verified downloads and current comparison evidence; it returns `galleryUrl`, `designNumbers` and `count`. Completed review evidence is immutable; inspection remains available, but another `slot.review` cannot rewrite the receipt's evidence. Return the authenticated collection link to the owner. “Complete” is collection review readiness, not a physical print assessment or product release.

For a protected file download, use `pnpm design-agent download --input download.json` with `{ "assetId": "<asset UUID>", "output": "<private local output>" }`. It writes atomically, refuses to overwrite an existing file, and reports bytes/SHA-256. Match those values to the registered asset. Reuse a verified existing download or choose a new output path; do not delete the only preserved source to get around a conflict.

### Prepare a transparent master for existing artwork

A design whose artwork only exists on a flat matte has no browsing sizes and no garment-color preview, because the app never removes a background. `scripts/artwork/prepare-transparent-prints.mjs` removes the matte locally, enlarges to a 4800-pixel long edge, and writes contact sheets rendering every cutout on a light and a dark garment.

**Look at the sheets.** No threshold can judge this work: matte-coloured ink is invisible to every colour metric, so a dark illustration on a dark backdrop loses its shading while the numbers report a clean result. Damage to light ink shows only on dark and damage to dark ink shows only on light, which is why there are two sheets. Applying needs `--reviewed` listing the display numbers actually inspected.

`revision.prepare` takes `designId` and a revision whose print asset is a verified transparent PNG; it adds that revision to the design and makes it current, leaving earlier revisions and any favorite pinned to them alone. `revision.upload` and `revision.finalize` complete the same byte-verified handshake as `asset.upload`/`asset.finalize`, scoped by `revisionId` instead of a batch.

Record the five garment colors with `design.colors`, passing `designId` and an ordered `colors` array of names from `GARMENT_COLORS`. It replaces the whole set, so send every color the design should offer. A design bound to a Printify product takes that product's offered colors.

After assessing the intended print size, use `artwork.assess` with `revisionId`, `widthInches`, `heightInches`, actual source-detail `nativePpi` and `notes`. Enlarged dimensions do not increase native detail. Assessment belongs to the exact stored transparent revision and garment placement; inspect the file and report limitations rather than deriving a quality claim from DPI metadata.

### Create a draft from the design page

`GET /api/admin/concepts/<design>/draft?number=<display number>&revision=<revision>` answers with the proposal and writes nothing. `POST` to the same path runs one step, `{ action: "create" | "reconcile", requestId, displayNumber, revisionId }`, and the page repeats `create` with the id the server answers under until `pending` is 0. Both need the signed-in administrator; `POST` also needs the store's own origin.

The recipe is [built](../src/features/design-products/build-design-recipe.ts), never typed in, and an agent gets the same build from [`drafts.propose`](#propose-drafts-in-each-designs-own-colors). `products.recipes` alone could not do it, because a recovered recipe carries only the colors of the tee it came from. So the design's `library_design_colors` names are matched against the provider's catalogue for blueprint 1317 and print provider 99, which is the one model `GARMENT_COLORS` describes; sizes, the price of each size, the placement and the garment, care and size-guide HTML come from the published recipe. One size published at two prices is a blocker rather than a coin toss. Only the design's own paragraph is written, from its summary.

The review names the published placement reference by title and Printify product id before **Create draft**. The lowest usable product id remains the default; changing the Featured order does not change it. When other usable products of this model have different placements, the review warns that this draft copies the named reference. That warning does not block creation. Inspect the draft's mockups before publishing, since different artwork can need a different size or position.

A request that already exists is continued from its **own frozen input**, never from a recipe rebuilt at that moment: availability may have moved, and `drafts.create` refuses different instructions under one request id. A reload loses the page's request id, so a second click that finds the model `reserved-elsewhere` by this same owner carries that earlier request on. An uncertain create offers **Check Printify again**, which is `drafts.reconcile`; it never offers a second create.

An administrator's session has no agent grant, so its attempts and artwork capabilities carry a null `grant_id`. Nothing is loosened for agents, which always carry a real grant that is still re-checked. For a null grant the artwork route relies on what it already required of everyone: active membership and a confirmed, unbanned identity, read again when Printify fetches the file. The draft pipeline re-reads that same standing before every provider write.

### Propose drafts in each design's own colors

`drafts.propose` (scope `drafts:create`) takes `numbers`, 1–50 permanent design numbers, and answers `{ modelLabel, proposals }` with one proposal per distinct number, in the order asked. It is the design page's review step for a whole page of designs: it reads the library, the shop's published tees and Printify's catalogue **once for the page**, and it writes nothing here or at Printify. No request is frozen and no binding is reserved.

It takes no model, because it proposes exactly one: the library's garment model, blueprint 1317 from print provider 99, named in `modelLabel` and in every recipe's `blueprintId` and `printProviderId`. A design's assigned colors are `GARMENT_COLORS` names, and those describe only that garment from that provider. For any other published model a proposal is the wrong recipe, not a starting point: sent unchanged it would create a 6210 in place of the garment asked for. Such a draft is built from that model's own `products.recipes` entry, with that tee's colors, and the owner is told so.

Each proposal carries:

- `number`, and `design` as `{ id, displayNumber, title }`, or `null` when the number finds nothing;
- `revisionId` — the revision a numbered selection would freeze **at this moment**: this owner's pinned favorite, otherwise the design's current revision. It follows the heart as it is when the proposal is made, so it is a default, not a record;
- `recipe` — a complete `drafts.create` recipe [built](../src/features/design-products/build-design-recipe.ts) exactly as the design page builds it, or `null` whenever `blockers` is non-empty. A partial recipe is never offered;
- `colors` and `sizes` — what the draft would actually be offered in, with each size's price;
- `skipped` — garments the design asked for that are left out, as `{ color, size, reason }`. A `size` of `null` means the whole color is unavailable;
- `placementDonor` — `{ productId, title, placement }` for the published product whose front placement is copied, or `null` when no placement reference is available. `title` is `null` when the saved product has no title, and `placement` holds the exact `position`, `x`, `y`, `scale` and `angle`;
- `unverified` — the model's recovered facts that remain unverified, including `placement` when another usable published product differs from the selected reference;
- `blockers` — why this design cannot be drafted yet, in the design page's own words.

One design's refusal never fails its neighbors: a missing number, an archived design, no assigned colors and no summary are each that proposal's own `blockers`. A store without `PRINTIFY_DRAFTS_API_TOKEN` fails the whole command, because nothing could be proposed from a guess. When no design in the page could be drafted anyway, neither the shop nor Printify is asked anything.

**Read `skipped` before creating.** One binding per shop, canonical design and model means a draft cannot be redone later for different colors, so the moment to tell the owner that Sand is unavailable is before the reservation, not after. Artwork readiness is not part of a proposal: `drafts.create` answers an unprepared revision as `needs-input` for that item and reserves nothing for it.

Name the `placementDonor` and report `unverified` before creating, including differing published placements when `placement` is listed. These fields describe the proposal; they do not change the creation recipe. A missing or otherwise refused design whose model was never read carries `placementDonor: null` and `unverified: []`.

To create, send one `drafts.create` **per design**, each with its own saved `requestId`, `selection: { "kind": "revisions", "items": [{ "designId": <design id>, "revisionId": <revision id> }] }` and the proposal's `recipe` unchanged. A recipe is per-design once colors differ, and one request freezes one recipe, which is why a page of proposals becomes a page of requests rather than one. Save each whole input before sending it: continuing a request means repeating those identical bytes, and a recipe proposed again later can differ because availability moved. Propose again only under a new request id.

**Take the recipe from the proposal and the revision from the operation.** A single `favorites` selection froze the owner's whole set on the server when the request started. A page of per-design requests has no such snapshot, so the agent records every design and revision ID before it proposes anything, and each request names the revision from that record. A heart moved or removed between recording and proposing changes the proposal's `revisionId` and must not change the draft. The proposal's `revisionId` serves a numbered request that names no exact revision. The recipe does not depend on the revision at all.

**A `draft` result is not proof the recipe was applied.** `drafts.create` reuses an existing binding for the same canonical design and model, and answers `draft` with the same message whether this request made the product or found it: the existing draft's variants are neither compared with the new recipe nor changed by it. `owningRequestId` tells them apart. Equal to this request's ID, this request's frozen recipe made the product. Another ID or `null`, an earlier draft was reused as it was, and the proposal's colors were not applied. A design's `products` in `library.get` and `library.favorites` shows an existing product of the model before anything is proposed.

It sits under `drafts:create` rather than `library:read` because it spends the store's drafts token on a catalogue read, and only an agent that may create a draft needs the answer. The token stays on the server: a proposal holds catalogue variant ids, color and size names, the shop's own prices and the published description, none of which the credential protects. The server does not force a later `drafts.create` to use a proposed recipe, so an agent that types its own is still bound by every check below, and is still the one answerable for which colors it chose.

### First product with an explicit recipe

The design-page button and `drafts.propose` need a published garment donor. `drafts.create` accepts a complete explicit recipe and can create the first product without one. This is the preferred agent path for an empty store because it keeps the normal product reservation, immutable revision, protected upload and provider receipt.

First verify live catalog variants and provider print-area support, owner-approved prices/placement, accurate garment/care/size-chart facts, and a ready assessed transparent private artwork revision. Use authenticated browser/editor inspection where it helps establish those settings. The server validates variant IDs, colors/sizes and front position against the current provider catalog, but it cannot decide whether the merchant's price or artwork scale is appropriate.

Create a private operation input such as `output/first-product.json` using this shape. **This is a scaffold, not a runnable product recipe:** all zero IDs/prices and angle/placement values must be replaced or explicitly confirmed from the actual provider and owner choices; UUID fields must use generated request and existing exact design/revision identities. Keep the same completed request bytes and request ID when resuming.

```json
{
  "command": "drafts.create",
  "input": {
    "requestId": "<new request UUID>",
    "selection": {
      "kind": "revisions",
      "items": [{ "designId": "<actual design UUID>", "revisionId": "<approved revision UUID>" }]
    },
    "recipe": {
      "blueprintId": 0,
      "productModelLabel": "<verified model name>",
      "printProviderId": 0,
      "variants": [{ "id": 0, "price": 0, "color": "<verified color>", "size": "<verified size>" }],
      "placement": { "position": "front", "x": 0.5, "y": 0.5, "scale": 1, "angle": 0 },
      "description": "<approved design copy and verified garment/care/size-guide HTML>",
      "titleTemplate": "{title}"
    }
  }
}
```

With `DESIGN_AGENT_URL` and `DESIGN_AGENT_TOKEN_FILE` configured securely:

```sh
pnpm design-agent request --input output/first-product.json
```

Read every result. Continue the identical request while it is pending; use its reconciliation path for an uncertain create. Inspect the saved draft's mockups and actual settings before authorized publication. Complete Categories and Garment models before showing it. Once its verified snapshot is published, the model can become a donor for later proposals. `drafts.reconcileBinding` requires a binding that already exists; it is not a generic registration command for any manually created Printify product.

### Create or reconcile drafts

Use the same `pnpm design-agent request --input command.json` entrypoint with a `drafts:create` grant. `drafts.create` takes an `input` object containing a stable request UUID, a selection and a complete recipe. See [draft input validation](../src/features/design-products/validate-design-draft-input.ts) and [the adapter](../src/features/design-products/get-design-draft-services.server.ts).

| Input                                                        | Required value                                                                                                                                                                                                                            |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `requestId`                                                  | Stable UUID saved with the entire request.                                                                                                                                                                                                |
| `selection`                                                  | `{ "kind": "numbers", "numbers": [149] }`, `{ "kind": "favorites" }`, or `{ "kind": "revisions", "items": [{ "designId": "<UUID>", "revisionId": "<UUID>" }] }`.                                                                          |
| `recipe.blueprintId`, `productModelLabel`, `printProviderId` | Verified garment blueprint/model and provider. The stable binding model is `printify-blueprint:<blueprintId>`; changing the provider does not create a new model.                                                                         |
| `recipe.variants`                                            | Each provider variant's integer `id`, positive `price` in cents, `color` and `size`. Take them from `drafts.propose` for the design's own colors; otherwise use the owner's prices/rule and the provider's actual supported combinations. |
| `recipe.placement`                                           | `position: "front"`, `x` and `y` in 0–1, `scale` greater than 0 and at most 10, and integer `angle` in 0–359. This adapter supports the explicit front-art recipe; additional print areas require an extension.                           |
| `recipe.description`, `titleTemplate`                        | Approved/delegated description and title. The title template supports `{title}` and `{number}`.                                                                                                                                           |

The front-art adapter can recognize the provider's existing neck care-label metadata during readback; that exception does not support custom neck/back artwork or extra merchant layers. Nondefault production controls such as mirroring, embroidery, patterned artwork or a printed background need an explicitly supported recipe, not silent approval because the main PNG matches. Preserve recognized care metadata in the saved production evidence.

The backend requires a separate server-only `PRINTIFY_DRAFTS_API_TOKEN` and the store's `PRINTIFY_SHOP_ID`. Missing draft credentials fail before a request or product reservation is created. Keep the fulfillment and publishing tokens separate. Draft work needs `products.read`, `products.write`, `uploads.write` and `catalog.read`; `shops.read` supports shop selection and `print_providers.read` supports provider discovery. The same `catalog.read` serves one read outside draft work: the owner's **Look up name from Printify** button under [Garment models](printify-catalog.md#adding-a-garment), which reads a blueprint's brand and model by id and changes nothing. Confirm current [Printify access scopes](https://developers.printify.com/#access-scopes) for the intended account. This draft path makes no order or publishing calls; do not confuse these permissions with fulfillment's `orders.write` or the separately configured publishing integration. Normal agents use app grants rather than receiving those provider credentials.

A response with `reserved-elsewhere` identifies another frozen request, not an existing product. For the same owner it includes `owningRequestId`; continue that original request instead of inventing a replacement UUID. Another owner's reservation does not disclose their request ID.

Only a known unsent invocation or a definitive parsed Printify rejection can reset a saved create intent. The adapter distinguishes documented client rejection statuses 400/401/403/404/422 with a valid error body from timeout, network failure, 408/429/5xx, malformed responses and lost receipts. Rejection messages are sanitized; private receipts retain the status and requested payload without provider error bodies or capability URLs. A rejected attempt reports `needs-input`: after correcting credentials, retry its original input; for changed product settings, submit a new request UUID. That new request may supersede only the same owner's unleased, explicitly rejected or invalid-before-submission attempt with no product/candidate evidence. A revoked grant detected before the POST leaves the exact original request resumable after authorization is restored. Failed pre-create reads release the lease immediately.

An upload receipt with the wrong dimensions or MIME type is saved as unused-image evidence, its capability is revoked, and the same request can retry the upload. An unconfirmed image upload may leave an orphan image, but cannot by itself create a product.

Post-create readback still requires the intended price, enabled variants, model/provider and production placement/artwork. Text comparison tolerates surrounding whitespace, line-ending and Unicode normalization; substantive text or HTML changes still need review. Actual title, description, prices and production fingerprint are retained as private readback evidence. A verified product ID remains visible after a mismatch: correct that existing draft in Printify and run `drafts.reconcile` for the same request. Do not create a replacement. Immutable provenance conflicts remain explicit operator attention rather than overwriting an approval.

An authorized draft upload lets Printify fetch only its exact print file through a short-lived server capability. The capability URL is passed directly to Printify, stays out of receipts/chat, and is not a permanent public Blob URL. Keep its grant/membership checks and private/no-store response intact; it must not become a general artwork-sharing endpoint.

The capability origin comes from configured `NEXT_PUBLIC_SITE_URL` through `getSiteUrl`, never the incoming request's Host. Before a real draft-upload test, verify that this origin reaches the exact deployment/database holding the capability and is reachable by Printify without a Vercel sign-in wall. A protected preview whose canonical URL points to production does not verify the preview's provider upload. Use an explicitly configured, reachable isolated domain/database/provider setup for an isolated test; do not casually change production's canonical URL or make private masters public to work around access.

No provider, price or placement defaults are supplied by the command. Reuse established owner choices; resolve missing ones before executing. A numbered selection uses that owner's pinned favorite revision when present, otherwise the design's current revision. Use explicit `revisions` when the request specifies another exact revision. Favorites are frozen across the whole owner's account when the request first starts; later heart changes cannot change that operation.

Each `drafts.create` call advances at most one eligible product operation and returns `{ requestId, results, pending }`. Continue the **identical input and requestId** until no eligible work remains. Inspect each result's `status`, `message`, `requestedRevisionId`, `boundRevisionId`, `productId`, `storefrontUrl` and any `blockingProductIds`; `pending: 0` can include unresolved items and is not proof every product succeeded. A normal `busy` result can be another queued item in this request. Continue eligible work; if an active lease or conflict prevents progress, inspect the existing operation and respect its retry timing rather than spinning or creating a fresh request to bypass it.

Use `drafts.reconcile` with the saved `requestId` for an uncertain create. It advances one uncertain operation using provider reads and records the evidence; it does not create another product. Use `drafts.reconcileBinding` with `bindingId` from the library product record for existing bindings. That path verifies the actual provider artwork source against the prepared revision and updates the database state/immutable artwork registry. Neither reconciliation command publishes products. Missing full source, ambiguous matches or absent uncertain results remain unresolved; a thumbnail or title match is insufficient.

Reconciliation can also resume a source scan interrupted before product creation. Exact full-source byte/pixel evidence is retained per provider image and hashed source URL so a deadline does not discard earlier comparisons. `blockingProductIds` identifies products whose source cannot yet be verified. Only a completed scan with no submitted create and no previously proven matching product can return the operation to ready; continue its original `drafts.create` input. A previously found candidate disappearing is not permission to create a replacement.

A previously saved product receipt can be stale. Reconcile an existing binding before describing its state as freshly verified. Verified matching drafts are reused. Revision mismatches require an explicit existing-draft edit workflow; this command does not implement that edit or a duplicate listing. An active publication snapshot remains the authority for the published revision and store link even when the current Printify draft has changed; report the unresolved draft separately. There is no product-publish command in the default agent API.

After an explicitly authorized Printify publication, the existing signed webhook/worker resolves the immutable registry against the actual production fingerprint. It derives a transparent WebP of at most 1200 pixels and at most 75% of each source dimension from the exact private print asset, uploads only that derivative to the public product-image store, and pins `storefront_artwork` in the saved snapshot. Publication acknowledgment updates matching library badges; confirmed removal clears them, and an unmatched new publication requires reconciliation. Later draft edits cannot replace that snapshot's art. Encoding uses the remaining worker deadline with time reserved for storage; `IMAGE_DERIVATION_TIMEOUT` requires attention instead of repeatedly retrying the same encode budget. See [website artwork previews](artwork-previews.md).

## Verify and hand off

Record exact collection/design/revision identities, requested and completed counts, upload/validation results, frozen selections and operation receipts. Check representative authenticated download bytes against the recorded hashes. Keep local fixtures, deployed app checks, real Auth/passkey behavior and current provider reads as separate evidence.

A real API product-create/readback and Printify's fetch of the capability URL remain controlled rollout checks requiring an authorized draft test. Read-only inventory and fixture tests do not prove provider create echo behavior. In particular, verify the current provider's dimensions, text normalization, enabled variants and pricing without weakening production checks. Empty inventory after a possibly sent POST is not proof that no product was created; there is deliberately no release command based solely on absence.

Before rollout, verify narrow layout, keyboard/focus, cross-session personal favorites, separate-admin isolation, revoked membership/grant denial and private asset cache behavior. Generation, import, publication and manufacturing retain their own completion checks. A new brand gets a fresh database/storage/auth setup and empty operational library; it never inherits this store's users, artwork, numbering history, favorites, grants or provider bindings.

## Design of the Week

Weekly features now select **individual published products** in `/admin/products`. Browsing a design
can create a Printify draft; publish that draft in Printify, then use its product row's **Add to Design
of the Week** action. A design itself cannot be queued, and matching artwork never adds another product
implicitly.

When `storeConfig.features.designOfTheWeek` is enabled, the lineup offers the next six slots from the configured time zone and weekly cadence, with room for multiple
products under each date. A scheduled hidden product stays hidden until its chosen instant. **Show in
shop** makes a product visible immediately and makes it the newest tee in the shop: Newest sorts by that
moment, and the product carries a New badge for two weeks. A scheduled reveal counts the same way from
its instant. Products on an unfinished garment must be completed under **Garment models** before they can
be shown or scheduled.

**Hide from shop** keeps the weekly assignment. Restoring its automatic reveal is best effort: if
the garment is incomplete or another editor holds its row lock, the product hides without a reveal
date. Use **Show in shop** or reschedule after the garment is ready to restore its release.

The Home page's Design of the Week section at `/#design-of-the-week`, below the brand introduction,
renders the shop's own product cards for the explicit roster, intersected with
the live catalog. Prices, images and availability come from those products; private design-library
notes and artwork records are not part of the section. When `storeConfig.features.dropSignup`, `storeConfig.configured` and `storeConfig.policies.published` are true, it includes the email signup form even when there are no weekly products. Once [drop emails](drop-emails.md) are enabled, everyone on the list gets one email on each drop's day. The footer links to this anchor only while the weekly feature is enabled. Signup can also run independently on the home page with the weekly feature disabled. The feature expires at the next
weekly slot; products that have already appeared remain for sale. See the
[Home rendering decision](printify-catalog.md#the-design-of-the-week) for its live-clock and caching behavior.

The cadence comes from `storeConfig.weeklyFeature` and `storeConfig.timeZone` in `src/lib/store-config.ts`. Each week’s instant is solved from that named time zone’s wall clock across daylight-saving changes. Hidden product previews at
`/admin/products/<product-id>` require an administrator and return 404 to anyone else.

## Featuring a design as an agent

Select individual published products under **Products** to schedule a weekly feature. Agents can prepare drafts through the commands below; publication and scheduling remain distinct owner-authorized steps.

`products.recipes` (scope `library:read`) answers with the product models this shop has **already
published**, one entry per blueprint and print provider, recovered from the saved products
themselves. It exists so the agent offers a short real list rather than the whole Printify
catalogue. Its `variants` are the colors of the tee it was recovered from, not any one design's:
for a draft in a design's own colors, [`drafts.propose`](#propose-drafts-in-each-designs-own-colors)
builds the recipe. Every entry carries:

- `variants`, `placement` and the ids of the published tees it was recovered from;
- `placementDonorProductId` and `placementDonorTitle` — the id and title of the published product whose usable single front placement is copied. Both are `null` when no placement was recovered; the title can also be `null` for an untitled reference;
- `sizeGuideDonor` — the id, title and description of the published product whose garment, care
  and size-chart text is copied;
- `unverified` — values recovered from a past publish that only Printify can confirm are current.
  `variants[].price` is always listed, because price is absent from the production fingerprint, so a
  change at Printify would not have failed a publish. `placement` is also listed when another usable
  published product of this model has different placement coordinates;
- `blocked` — why this model cannot be offered yet. A non-empty `blocked` means do not create a
  draft from it.

A model is blocked when no enabled priced variants were recovered, when no published product of it
yields a usable single front placement, or when no published product of that model has a size chart
to copy. A tee with artwork on the back or layered
artwork is skipped for placement rather than blocking the model by itself, and it can still lend
its size chart, which describes the garment rather than the print.

Products are read in ascending product id order, so the variants, the placement and the size-guide
donor each come from the lowest id that has one. The owner's Featured order does not move them.
Different designs can have different print sizes; they do not all have to share coordinates. The
chosen placement donor must still use the same single front placement across its variants.
Differences between usable products preserve the selected donor and add `placement` to `unverified`;
the admin review and `drafts.propose` expose that donor and the uncertainty before creation.
Printify's required neck care label and its exact default font settings do not count as extra artwork.

**Nothing about a garment is invented.** Measurements, care text, fabric claims and prices are facts
about a real product. The description for a new tee copies the garment, care and size-guide HTML
from a published product of the same model, and only the design's own paragraph is written. The copy
starts at the donor's garment heading, the one the product page shows as "The garment": "The tee",
"The crop top", or any other heading or bold-only paragraph that is not the design, care or sizing
section, or the donor's own title. A donor with only a care section still lends it. Charts
can carry `id="size-guide"` or the recognizable apparel measurements supported by the storefront
parser. If Printify puts the chart before the old design paragraph, the draft carries it after the
copied garment sections. Equivalent copies become one chart; conflicting measurements or an
unreadable marked chart block that donor instead of choosing which facts to trust. Provider
indentation is removed from the table to fit the description limit; the cells, measurements and
styling are retained.
The title template is `{title}` and nothing else: the storefront appends its own suffixes, so a
title carrying one would double up.
