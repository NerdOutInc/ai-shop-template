# Compose the release as a pair

Start with the garment scale and the target viewport crop. Build the scene around the calibrated products. Distinct concepts vary their scene structure, palette, lettering and arrangement; a new color wash on the same layout is not a new direction.

Generate scenery separately from merchandise where possible. A useful prompt skeleton is:

> Create a [target canvas/aspect] background for [approved visual direction]. Leave [measured regions] clear for actual product photographs to be composited later. Use [brand palette, lighting/material language]. Include only [approved lettering if needed]. Preserve [specific accepted composition elements]. Do not invent extra products, logos, offers or slogans. Return the best native resolution supported by the tool.

Only add a ban on people, hands or props if the project's brief calls for one. If people are included, use approved model references and the target's naturalness requirements; this skill provides no model identity. Match subject lighting, cast shadows and camera perspective to the scene instead of giving the model independent studio lighting.

## A responsive example, not a universal setting

A renderer may use a 3:1 desktop panorama whose middle half remains visible on ordinary screens and whose outer quarters reveal scenery on wide screens. For a 2400 × 800 source, that safe center is x = 600 through 1800. Headline, offer, whole products and their shop labels must fit inside it. The scenery should continue naturally into the sides, not become padded bands or blurred duplicate wings.

The same renderer may use an independent 4:7 mobile composition. Arrange its type, merchandise and links deliberately. Shrinking the desktop poster or putting a detached block of text above it often loses the composition's hierarchy. Neither ratio is a requirement of this skill: inspect the target before choosing it.

[The illustrative layout](hero-layout.svg) shows source coordinates and safe regions. It is a schematic with no real products or brand assets. [The layout helper](layout-helper.md) converts final measured pixel rectangles using the **full source canvas**, not only the desktop's safe center.

## Inspect before multiplying a mistake

Finish and inspect one paired direction with the calibrated garment layers before producing the rest. This early checkpoint catches a wrong transparent-canvas interpretation, shrunken crop print or incorrect neckline gap before it contaminates a batch. It does not reduce the user's requested number of finished concepts.

After the owner chooses a direction, make targeted refinements with retained layers. A spelling change should not regenerate the garment; a shirt that sits too far left in a scene needs a scene transform, not a new print offset. Retain lossless masters and source-native dimensions. Upscaling does not create detail.

Use this final review order:

- Verify each pictured product/color and original art revision; compare all four placement constraints in the garment guide.
- Inspect garment construction, print texture, edges and light/shadow consistency at full size.
- Read every visible word and verify the price/offer against current terms. Native accessible text must agree with the pixels.
- Check both viewports' safe areas, visual hierarchy, copy legibility and separate click destinations.
- Recompute click regions from final files and inspect the actual saved browser preview, keyboard interaction and correct color destination.

The helper can check arithmetic, not whether a rectangle covers the shirt or whether the print is centered. Review the image and its current references. If a reviewer is uncertain, retain that status and improve the evidence or output before calling it accepted.
