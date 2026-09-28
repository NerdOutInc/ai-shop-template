# Reusable store-design prompts

Fill the inputs from the owner's current request and preferences. Placeholders are inputs, not inferred defaults; use the actual requested count and preserve approved brand choices.

The examples below demonstrate flat illustrated artwork. Replace their art-direction paragraphs with the owner's chosen style; they are not a required aesthetic for every store.

## Explore one idea

```text
Use $store-design-concepts. I have a shirt idea for {{BRAND}}:
{{IDEA}}.

Generate exactly {{COUNT}} distinct interpretations for me to choose from.
Keep the core idea recognizable, with flat 2D illustration and creative
custom lettering. Vary composition, visual joke and art direction; don't
give me the same drawing in different colors. Preserve these details:
{{REQUIRED_DETAILS}}.

Design for our store's Next Level 6210 setup and suitable shirt colors.
Deliver verified transparent PNGs and the review gallery with personal
favorites, garment-color previews and full PNG downloads. Review our existing
concept library first. Add this as a new collection in our private admin app,
preserving older collections. Give me the collection link and permanent
design numbers. Preserve native originals separately from prepared PNGs.
I will favorite one or more designs and then ask you to add my favorites
to the store.
```

For example, an actual request can ask for 10 interpretations. Use the number the owner requested, not a hidden skill default. A later “Add my favorites to the store” resumes the existing gallery and product workflow; it does not generate new images or ask for the count again.

## Explore a broader collection

```text
Use $store-design-concepts to generate exactly {{COUNT}} materially distinct
T-shirt designs for "{{BRAND}}", celebrating {{AUDIENCE_OR_THEME}}.

Draw inspiration from https://www.threadless.com and
https://www.threadless.com/parody/ for flat illustrated visual jokes,
inventive compositions, and expressive lettering. Create original designs.
The work should be cute, funny, creative, and confidently 2D. Avoid rendered
3D, photorealism, fake product photography, and glossy dimensional effects.

Explore genuinely different design languages, including {{GENRES}}. Some
designs can announce the theme immediately; others should look like a
convincing example of another genre until a closer look reveals the joke.
Make the hidden meaning part of the composition, not a tiny pasted icon or
unreadable microtext. Vary layout, silhouette, lettering, visual mechanism,
and palette rather than producing recolors of the same design.

"{{BRAND}}" is the clothing brand. Spell it exactly and feature it as part
of each design using custom lettering appropriate to that design. No fixed
official logo unless supplied in the brief. It can be balloon lettering,
heavy-metal word art, collegiate type, or another inventive treatment.
Full color, limited color, and single-color artwork are all welcome.
Preserve these additional owner choices: {{REQUIRED_OR_EXCLUDED_CONTENT}}.

Design for Next Level 6210 shirts:
https://printify.com/app/products/1317/next-level/unisex-cvc-jersey-t-shirt
Check the selected provider's actual print area and offered shirt colors.
Use those colors as review-gallery backgrounds, while keeping the artwork
itself on a genuinely transparent background. Show the complete design,
with no shirt, model, mockup, baked background, or decorative frame unless
that frame is intentionally part of the printable artwork.

Deliver a high-resolution transparent PNG for each concept. Establish the
intended print dimensions and pixel target before generating the batch.
Verify real alpha, actual native and final pixel dimensions, readable brand
text, clean edges, and suitability at the intended print size. Keep native
originals and clearly label any enlarged derivatives. Do not call a smaller
concept file print-ready merely because its DPI metadata says 300.

Use our private admin gallery with search, collection and design-family
filters, personal favorites across collections, S/M/L sizing, garment-color
previews, and permanent detail links with keyboard access. Every detail
view must have a working download link to that design's full transparent PNG, with actual pixel
dimensions and any print-size limitation, rather than its gallery thumbnail.

Review our existing concept library before generating. Validate the complete
batch and gallery, then add it to our private admin library as a new
collection. Preserve all earlier collections and personal favorites. Return
the collection URL and permanent design numbers. Verify authenticated
downloads return the exact recorded bytes; preserve native originals,
prompts and immutable revisions in the private library. Favoriting must
keep the exact revision I reviewed so it can become a product afterward.
```

For an explicitly requested local review, replace the app-delivery instruction with that limited outcome; local HTML does not complete an app upload. Public sharing requires a separate explicit request and an appropriate approved derivative. For a brand with an official logo or a different lettering rule, replace that paragraph rather than layering contradictory directions. Remove irrelevant genre examples; the selected genres should fit the actual brand.
