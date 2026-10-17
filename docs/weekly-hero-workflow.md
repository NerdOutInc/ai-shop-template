# Portable weekly hero workflow

Use [store-weekly-hero](../.agents/skills/store-weekly-hero/SKILL.md) to create desktop/mobile homepage concepts from an existing product release. Its folder contains all instructions, a neutral coordinate diagram and a Python standard-library helper for measured click regions. It includes no merchant artwork, generated model identities, account settings or production assets.

The package covers release evidence, original print identity, garment-specific calibration, paired composition, concept counts, final review, click regions, saved previews and compact replayable retention. It teaches the method independently of this application; it does not bundle an image-generation service or add a store editor.

## Use outside this repository

Copy the complete `.agents/skills/store-weekly-hero/` directory to the skill directory your agent host supports. Do not copy only `SKILL.md`: its relative references and helper are part of the package. In hosts with a GitHub skill installer, request installation from `NerdOutInc/ai-shop-template`, path `.agents/skills/store-weekly-hero`, at a reviewed commit or release ref. The repository's access rules still apply. This change does not change repository visibility or licensing.

The instructions require only host-provided image/browser/file capabilities appropriate to the task. The optional click-region helper is supported and tested on Python 3.12 (CI pins 3.12.13) with no third-party packages. It can be run from the copied skill folder using that interpreter:

```bash
python3 scripts/measure-click-areas.py references/layout-example.json
python3 scripts/measure-click-areas.test.py
```

No application checkout, sibling skill, store login or network is needed for that arithmetic check. Image generation, product evidence retrieval, browser preview and publication require the corresponding capabilities and authorization in the receiving project.

## Current application boundary

At template base `9a345a98549926443e6ed5a413ccb329d37525ad`, the application has a weekly product lineup and release cadence, but **does not have a weekly hero asset upload, editor, approval store, preview or scheduled renderer**. Read [Design of the Week](admin-design-library.md#design-of-the-week) for the implemented product workflow. The skill can prepare and review selected assets now; it must report hero scheduling unavailable here until a runtime is implemented.

The template's cadence comes from `storeConfig.timeZone` and `storeConfig.weeklyFeature`; do not copy the source store's weekday/hour or derive a fixed UTC offset. Hero dimensions and safe areas must come from the eventual receiver, not from an illustrative skill diagram.

## Focused runtime catch-up work

The runtime port is a separate application change tracked in [template PR #55](https://github.com/NerdOutInc/ai-shop-template/pull/55). Its source baseline (`original-store` in the [source-port ledger](source-port-ledger.json)) is pinned to these reviewed changes:

- Source PR #192, commit `977920bd2ffa708c4bf49f2cd2fbe61288d0bfd5`, parent `9b9616010a29056d0de6cd568c269603059b61f1`: responsive hero runtime, private uploads, editor, approval and scheduled rendering. Relevant paths are `src/features/weekly-heroes/`, `src/app/admin/products/heroes/`, `src/app/api/admin/weekly-heroes/`, `src/app/api/weekly-hero/`, `src/app/page.tsx` and `src/features/featured-order/`.
- Source PR #193, commit `8cb3eb5aa5009b18a584c760e1d0ee512a998431`, parent `977920bd2ffa708c4bf49f2cd2fbe61288d0bfd5`: follow-up product facts and shop action in `src/features/weekly-heroes/weekly-design-details.tsx` and its test.

PR #55 records the adaptation, migration identity and verification in its source-port ledger. It was open and unmerged when this receipt was checked on 2026-10-17; re-read its current state before relying on the runtime. This skill PR defers those application paths to that receiving PR and imports none of the source store's images, models, artwork or settings. Review the implementation and follow-up together; copying one documentation commit would not provide the feature. The runtime's minimal acceptance scope is:

| Area                               | Receiving requirements                                                                                                                                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configuration and schedule         | Use this template's configured cadence and named time zone, optional feature enablement, current week boundaries and existing product-week identities. Do not hardcode a source brand's fallback, two particular garments or Monday release time. |
| Private storage and administration | Immutable hero assets in the existing private store, current admin authorization, bounded validated uploads, versioned saves, and supported draft/approve/withdraw actions. Keep product publication and hero approval separate.                  |
| Destinations and visibility        | Validate actual week membership, products/colors and non-overlapping rectangles against the chosen layout. Future/draft assets remain private; expired or invalid heroes fall back to the target brand's current homepage.                        |
| Rendering and access               | Separate desktop/mobile sources, verified crop/safe regions, native links and equivalent accessible text. Preserve existing signup, weekly content, structured data and product privacy.                                                          |
| Deployment and evidence            | An authorized migration and deployment are distinct from a code merge. Test draft/future privacy, current-week eligibility, stale saves, time-zone boundaries and changed visibility; verify the saved preview and actual live state separately.  |

Keep that port scoped to the runtime and necessary schema/configuration changes. It does not need operational product photographs, source model portraits, a generated concept archive or hardcoded weekly product IDs. Until those contracts are implemented and verified, a concept package must not be described as scheduled or live.
