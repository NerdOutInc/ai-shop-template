---
name: store-model-casting
description: Create fictional adult model candidates or continue a selected model's identity across new photographs. Use for casting, recurring apparel models, and preserving a reusable cast; not for generating shirt artwork or publishing a catalog.
---

# A reusable cast

Separate **creating a new person** from **making another photograph of a selected person**. A new hairstyle does not establish a new identity; a saved prompt does not reliably restore an old one.

Use the caller's brand brief, requested count, audience and existing cast. This skill supplies no default roster, gender split, ages, body type, clothing brand or artistic reference. Resolve only missing choices that materially affect the requested work. Read the host's image-generation/editing instructions and use an available supported tool; the skill does not bundle a generator or authorize a paid API.

## Create new candidates

Read [casting direction](references/casting-direction.md) when planning a batch.

- Plan distinct candidates before generation. Vary facial structure, apparent age, proportions, hair, expression and styling independently. Accessories and hair dye should not become substitutes for facial variety. Respect the owner's requested mix without turning one suggested trait into a requirement for everyone.
- Assign stable IDs that are unused in the caller's cast. Keep one person per original image. Use a face-visible casting composition and neutral wardrobe that help compare people; these are inspection choices, not rules for later lifestyle photographs.
- Generate within the authorized count. Inspect each original for facial distinctness, anatomy, plausible proportions, visible marks and intended styling. Compare neighboring faces directly; different file hashes do not prove distinct identities.
- Retain the original image, exact prompt, ID, source dimensions/hash and review. Keep review thumbnails and contact sheets separate. A favorite or shortlist records a selection; it does not authorize storefront publication.

## Continue a selected identity

Read [identity records and continuation](references/identity-records.md). Open the selected original at useful resolution and use that individual image as an identity reference. A contact sheet or a textual description alone is insufficient when the original exists.

The visible reference outranks its generation brief. Preserve facial proportions, apparent age, skin tone, hairline/texture, distinctive marks, facial hair and body proportions. Preserve visible tattoo and piercing placement, not merely their existence. Do not invent measurements or unseen marks from a single view. An approved additional angle can supplement the anchor; drift in a new output must not redefine the original person.

Give the reference a clear role: **identity only**. Make a new exposure with a different pose, gesture, expression, camera position or setting when the task calls for varied photographs. Do not preserve the anchor's light and stance by accident. Attach garment and photographic references separately with their own roles. Generate a blank garment when exact artwork will be composited later.

Compare the new face and visible marks against the anchor before selection. Reject an attractive but different person. Keep the new output separately with the anchor hash, exact prompt, scene and any approved changes. Report uncertainty when a new angle cannot be judged from the available reference.

## Preserve the useful data

Store the approved original anchors and [identity records](references/identity-records.md) in the caller's chosen asset location, outside this generic skill. Keep full prompts and rejected-direction notes small and searchable. Do not commit every candidate, intermediate or gallery derivative by default; follow the project's retention decision and verify any durable archive before removing local sources.

Run the bundled [cast validator](scripts/validate-cast.py) against the caller-owned manifest before handoff; its exact schema and scope are in [identity records](references/identity-records.md). It verifies stored bytes/provenance, not visual likeness.

Deliver the requested candidates or new exposures, stable IDs, selection/review state and usable source references. Record the actual tool/model metadata available; do not invent a seed or claim deterministic regeneration. Exact garment construction, print geometry and fabric compositing require their own evidence even when identity continuity passes.
