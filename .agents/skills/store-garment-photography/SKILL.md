---
name: store-garment-photography
description: Create natural studio and lifestyle garment photographs using exact approved artwork, provider-specific placement and fabric-aware compositing. Use for apparel mockups and recurring model product photos; not for inventing print artwork or publishing a storefront.
---

# Natural photographs, faithful garments

Work from the caller's brand direction, selected identity, actual garment and approved artwork. This skill includes a calibrated compositor, not an image generator, product catalog or ready-made cast. Read the host's image-generation/editing instructions and use its supported tool. If code-based image editing requires explicit opt-in, check authorization in the active conversation before compositing; the presence of this script is not permission.

## Resolve the photograph's inputs

Establish the requested shots and colors, recurring-model references, garment/provider/size, original transparent artwork and saved placement evidence. Keep identity, garment construction and photographic references distinct, with explicit roles. The caller's brand brief supplies aesthetic preferences, activity exclusions and cast-pairing rules; do not inherit those from another shop.

Inspect current provider and manufacturer evidence for fabric weight, fit, collar, sleeve attachment and hems. A casting tee or generic garment outline does not establish product accuracy. Preserve uncertainty where the actual size, provider or saved placement is unavailable; label a proposal rather than inventing production facts.

## Direct and approve the blank first

Read [photographic direction](references/photographic-direction.md). Choose a specific moment, camera position and coherent light before deciding how to display the print. A useful question is whether the photograph would work with a blank shirt.

Keep the selected person recognizable while making each requested exposure distinct. Change pose, gesture, expression, camera or scene rather than recoloring the same photograph. Review anatomy, identity marks, body support/contact, shared lighting/focus and actual garment construction before adding ink. A successful generation call does not approve the photograph.

A studio image usually needs the shirt large enough to inspect. Lifestyle framing follows the moment and may hide part of the front. Respect the caller's visibility needs without shifting or shrinking the print to reveal it. Hands, hair, straps and folded-over fabric need explicit foreground masks when they cross the ink.

## Establish the print in garment coordinates

Read [placement review](references/placement-review.md) before choosing a projection. Use the original artwork and the matching provider's saved transform, variant/size print area and mockup together. A maximum print area is a boundary, not the intended print size. DPI metadata alone does not establish physical placement.

Mark collar and front-panel landmarks on the blank first. Account for the actual crop and perspective, and save the coordinate space. Trace folds on this exposure; do not reuse another pose's fold map. On-body dimensions inferred from a generated photograph remain estimates even when the input target inches are exact.

## Composite original ink into fabric

Read [job format and execution](references/job-format.md). The bundled [compositor](scripts/composite.py) accepts caller-supplied blank, original artwork, print geometry, texture patches and optional fold/mask data. Its fixed output is 1200×1500; use the documented final-image coordinate system.

The sample-calibrated-dtg-v1 preset preserves sharp source art while varying ink coverage with cloth texture and small sampled gaps, transferring fabric lighting, and applying restrained fold displacement. It does not blur artwork or add a raised edge. The preset is an empirical 2D treatment calibrated from a particular printed fabric sample, not universal DTG physics. Supply appropriate texture patches and inspect the result for the new fabric/material. Clean provider views use a gentler response. An artwork-only slide is the original transparent PNG over its chosen background color, without fabric simulation.

## Review, then select

Use [the four separate placement checks](references/placement-review.md): centerline, collar clearance, scale and occlusion. Inspect the actual final PNG/JPEG and their unmarked full and phone-sized views, not just a proposed rectangle. Keep annotated blank/final/provider comparisons. Record reviewer, evidence and exact final hashes. A second reviewer is useful for consequential or ambiguous geometry and is required where the caller's workflow calls for it; do not imply that an unavailable independent review happened.

`uncertain` is not a pass. Resolve it with clearer geometry, another independent opinion or a clearer exposure. Every image change invalidates its earlier approval. A hash or successful replay proves file identity, not correct fit, likeness or placement.

Preserve the approved identity anchor, chosen blank, original artwork, job, masks/folds, final and review in the caller's asset system. Keep previews and computational intermediates separate; use a manifest and restoration check before moving large sources out of Git. Deliver reviewable photos with explicit limitations. Generation, private gallery delivery, product approval and storefront publication are separate actions. When used inside the ai-shop-template repository, install approved photos on a published product with the admin Photos editor (`docs/product-gallery-workflow.md` in that repository); never edit provider snapshots or use raw SQL.
