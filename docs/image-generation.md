# Image generation

The creative skills (design concepts, model casting, garment photography, weekly heroes) need pixels from somewhere. This template bundles no image provider and pays for none. It bundles a small provider-neutral adapter, `pnpm imagegen`, so that Claude Code, Codex, Cursor and any other agent host can generate the same shirt concepts, blank garment layers, model shots and hero scenery with the same request file, the same receipt and the same authorization rule.

The adapter lives in `scripts/imagegen/`, runs on Node with `fetch`, and adds no application dependency. The app never reads it or its keys; `src/lib/env-schema.ts` and `.env.example` stay unchanged.

## One request shape

Write a JSON file and point the CLI at it:

```json
{
  "prompt": "Flat illustration of a badger reading a paperback in a hammock, bold limited palette, standalone printable artwork, no background",
  "referenceImages": [],
  "size": "1024x1536",
  "quality": "high",
  "background": "transparent",
  "count": 2,
  "outputDir": ".tmp/concepts/batch-7f3c/slot-03",
  "baseName": "slot-03-badger-hammock"
}
```

| Field             | Meaning                                                                                                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `prompt`          | The complete self-contained prompt. Write the prompt the skill tells you to write; the adapter adds nothing except a transparency instruction for providers that need one.                                                                                               |
| `referenceImages` | Optional PNG, JPEG or WebP paths. Each one's SHA-256 lands in the receipt. OpenAI receives them through the edits endpoint; Gemini receives them inline. State each reference's role in the prompt (identity only, garment construction only).                           |
| `size`            | `auto`, `1024x1024`, `1536x1024`, `1024x1536`, `1792x1024` or `1024x1792`. OpenAI accepts the first four; Gemini maps a size to an aspect ratio.                                                                                                                         |
| `quality`         | `auto`, `low`, `medium` or `high`. OpenAI passes it through. Gemini asks for a 2K image at `high`, which only the Gemini 3 image models accept; the default `gemini-2.5-flash-image` renders at a fixed resolution, so `high` is rejected before any request or dry run. |
| `background`      | `opaque` (default) or `transparent`. OpenAI renders real alpha. Gemini is asked for alpha in the prompt and does not guarantee it; the receipt reports what the file carries.                                                                                            |
| `count`           | 1–10 images from this prompt. OpenAI takes them in one request; Gemini takes one request per image.                                                                                                                                                                      |
| `outputDir`       | Ignored local staging, created on demand. Private masters never go to `public/` or Git.                                                                                                                                                                                  |
| `baseName`        | Files are written as `<baseName>-1.png`, `<baseName>-2.png`, … plus `<baseName>.receipt.json`. Existing files are never overwritten; pick a new name for a retry so the reviewed bytes stay put.                                                                         |

Paths resolve against the current directory. Run the CLI from the repository root.

## Choose a provider

`IMAGE_PROVIDER` selects the route. It defaults to `host`.

| Provider | Key                                       | What it calls                                                                                                                                 | Model override                                  |
| -------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `host`   | none                                      | Nothing. Prints the exact prompt, references and expected output paths for the host's own image tool, then `--complete` hashes what it saved. | n/a                                             |
| `openai` | `OPENAI_API_KEY` or `OPENAI_API_KEY_FILE` | `POST /v1/images/generations`, or `/v1/images/edits` when references are supplied. PNG output with real transparency.                         | `IMAGE_MODEL`, default `gpt-image-1`            |
| `gemini` | `GEMINI_API_KEY` or `GEMINI_API_KEY_FILE` | `models/<model>:generateContent` with image response modality, one call per image.                                                            | `IMAGE_MODEL`, default `gemini-2.5-flash-image` |

`OPENAI_BASE_URL` and `GEMINI_BASE_URL` exist for proxies and tests. Check each provider's current model list and pricing before a large batch; model names move faster than this document.

The host route is first-class, not a fallback. When the session's host offers an image tool (Codex and ChatGPT ship ImageGen; other hosts may ship their own), it is usually the cheapest and best-integrated path, and it keeps reference-image identity continuity inside the tool the owner already pays for. Use the adapter's host mode so the receipt and provenance look identical either way:

```bash
pnpm imagegen --input .tmp/concepts/batch-7f3c/slot-03/request.json
```

```json
{
  "status": "pending-host",
  "provider": "host",
  "prompt": "Flat illustration of a badger reading a paperback in a hammock, bold limited palette, standalone printable artwork, no background",
  "size": "1024x1536",
  "quality": "high",
  "background": "transparent",
  "count": 2,
  "referenceImages": [],
  "expectedFiles": [
    "/work/store/.tmp/concepts/batch-7f3c/slot-03/slot-03-badger-hammock-1.png",
    "/work/store/.tmp/concepts/batch-7f3c/slot-03/slot-03-badger-hammock-2.png"
  ],
  "nextStep": "Generate each image with the host's image tool using this exact prompt and these references, save PNG files at the expected paths, then rerun the same command with --complete to write the receipt."
}
```

Generate with the host tool, save each PNG at its expected path, then:

```bash
pnpm imagegen --input .tmp/concepts/batch-7f3c/slot-03/request.json --complete
```

`--complete` reads the files, hashes them and writes the same receipt a paid provider would, with `provider: "host"` and `model: null`. A completed receipt is immutable: running `--complete` again with the same prompt and files returns it unchanged, and a changed prompt or a receipt written by a paid provider is refused. Record the host tool's name and any version it exposes in the skill's own manifest (`toolMetadata.tool`); the adapter cannot see it.

## Keys stay out of chat, Git and logs

Set the key in the process environment, or set `OPENAI_API_KEY_FILE` / `GEMINI_API_KEY_FILE` to a private file with mode `0600`, the same rule the design-agent credential follows. The adapter reads the value, sends it in the provider header and never prints, logs or writes it anywhere, including error messages and receipts. Provider error bodies are quoted only through their documented message field. Do not put a key in a command argument, a request file, `.store-setup.local.json` or a chat message. The app does not need these keys, so they do not belong in Vercel or `.env.example`.

## Cost controls and owner authorization

The creative skills already say that a large requested count does not authorize switching to a paid API. The CLI enforces that sentence. A paid provider refuses to run unless the command includes `--authorized-by-owner`, which asserts that the owner authorized paid generation in the active conversation. Pass it only when that is true; an authorization the owner already gave in the conversation covers the batch it describes and need not be asked for again.

`.store-setup.local.json` can record `delegation.imageGeneration.paidApi: true` when the owner delegated that choice during setup. The CLI reads it and reports it as `savedDelegation` in the dry run, so the agent can cite it, but the saved value never authorizes spending by itself: it is copied into later worktrees by `.worktreeinclude`, where the owner's actual instruction and its scope may be unknown. Follow the setup skill's [authority rule](../.agents/skills/store-setup/SKILL.md#authority-and-saved-progress) and keep the delegation `false` until the owner actually says yes. The flag is per command, so an agent cannot inherit it from an earlier batch by accident. The host route and `--dry-run` need no authorization: neither spends anything.

Before any paid batch, dry-run it and show the owner the cost-relevant numbers:

```bash
IMAGE_PROVIDER=openai pnpm imagegen --input .tmp/concepts/batch-7f3c/slot-03/request.json --dry-run
```

```json
{
  "dryRun": true,
  "provider": "openai",
  "endpoint": "images/generations",
  "model": "gpt-image-1",
  "count": 2,
  "size": "1024x1536",
  "quality": "high",
  "background": "transparent",
  "referenceImages": 0,
  "authorization": { "authorized": false, "source": "none", "savedDelegation": null },
  "wouldWrite": ["slot-03-badger-hammock-1.png", "slot-03-badger-hammock-2.png"],
  "outputDir": "/work/store/.tmp/concepts/batch-7f3c/slot-03"
}
```

Count, size and quality are the three parameters that drive the bill on every provider. Multiply the planned number of slots by `count`, name the model and quality, and let the owner decide. Keep `count` small while the brief is still moving; one inspected representative output is cheaper than ten wrong ones. Retries cost the same as first attempts and are provenance, not extra delivered concepts.

The destination is checked before any request: a `baseName` whose receipt is already complete, or whose output file already exists, fails without a provider call. When a multi-image Gemini batch stops partway (a rate limit, a blocked answer, a network failure), every image already returned is on disk and the receipt is saved with `status: "incomplete"`, `completed` and `requested`; rerunning the same command with the same request, provider and model verifies those files by hash, checks that no unrecorded file sits at a remaining path, and generates only the missing ones, so a retry never pays twice for a finished image. A different request, provider or model under the same `baseName` is refused rather than relabelling the saved images' provenance, and an unrecorded file left by an interrupted run must be inspected and moved aside before resuming.

## What the adapter never does

- It never redraws, repairs, upscales or "cleans up" approved artwork. Ink always comes from the private library's exact revision bytes; compositing scripts place it. A reference image is for identity, garment construction or style, never a way to regenerate a print.
- It never removes a background, validates transparency or judges print readiness. `alphaChannel` in the receipt says whether the PNG carries an alpha channel; the skill still inspects decoded pixels, contact sheets and garment-color previews.
- It never uploads anything. Private masters reach the store only through `pnpm design-agent upload` and the revision handshake, and public assets only through the documented public paths.
- It never chooses a provider, a model or a count on its own, and never spends without the authorization above.
- It never overwrites an existing output file, and never resumes a receipt that belongs to a different request.
- It never prints a key, and it redacts anything shaped like a credential or signed URL from provider error messages before they reach the terminal.

## Receipts feed provenance

A successful run writes `<baseName>.receipt.json` next to the images and prints it:

```json
{
  "schemaVersion": 1,
  "createdAt": "2026-10-20T15:04:05.000Z",
  "provider": "openai",
  "model": "gpt-image-1",
  "requestId": "req_7c1d…",
  "seed": null,
  "status": "complete",
  "requested": 2,
  "completed": 2,
  "request": {
    "prompt": "…",
    "size": "1024x1536",
    "quality": "high",
    "background": "transparent",
    "count": 2,
    "referenceImages": [{ "path": "…/model-017.png", "bytes": 1843201, "sha256": "…", "mimeType": "image/png" }]
  },
  "images": [
    {
      "path": "…/slot-03-badger-hammock-1.png",
      "bytes": 2210873,
      "sha256": "…",
      "mimeType": "image/png",
      "width": 1024,
      "height": 1536,
      "alphaChannel": true
    }
  ],
  "notes": []
}
```

`seed` is whatever the provider reports; today both providers report none, so it is `null` and no skill may claim deterministic regeneration. `requestId` is the provider's own identifier for support questions. `status` is `complete` only when `completed` equals `requested`; register nothing from an incomplete receipt until the rerun finishes it.

The receipt is the bridge into the store's records:

- **Design concepts:** after `slot.claim`, generate, then run `pnpm design-agent inspect` on the chosen file and pass the receipt's `prompt`, provider and model into the `slot.register` design record's prompt and mechanism fields. Keep the receipt beside the native original; the registered asset's SHA-256 from inspection must equal the receipt's `sha256` for that file, or the bytes changed between generation and registration.
- **Model casting:** copy each anchor's `sha256`, `width`/`height` and `prompt` into the cast manifest's `referenceImage`, `sha256`, `dimensions` and `originalPrompt`, and set `toolMetadata` to the receipt's provider and model (or `"host"` and the host tool's name). A continuation run lists the anchor under `request.referenceImages`, which is the continuity evidence the identity record asks for.
- **Garment photography and weekly heroes:** keep the receipt with the blank garment layer, background or scenery layer it describes. The composition record cites the layer's `sha256`; the receipt proves how that layer came to exist and that it was not an approved artwork file.
- **Uploads:** `pnpm design-agent upload` verifies bytes against the registered inspection hash, so a receipt whose hash matches the uploaded file closes the chain from prompt to private Blob.

Receipts contain prompts and local paths, not secrets. Store them with the operational assets in ignored staging or the private archive, not in Git.

## Verification

`pnpm test:imagegen` runs the adapter's tests with a mocked `fetch`; `pnpm test` includes it. No test, lint or check in this repository contacts a paid provider.
