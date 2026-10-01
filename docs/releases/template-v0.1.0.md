# template-v0.1.0 candidate notes

Status: prepared for review, **not published**. This is the first template release; no previous release or deployed-store upgrade is implied. The candidate manifest pins the exact Git commit/tree, lockfile and migration SHA-256, notes and included PR list. Recompute it from the final reviewed `main` commit before publication; feature-branch metadata is a candidate only.

## Included work

| Template PR                                                   | Change                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------ |
| [#1](https://github.com/NerdOutInc/ai-shop-template/pull/1)   | Bump supabase/setup-cli in the actions group across 1 directory    |
| [#2](https://github.com/NerdOutInc/ai-shop-template/pull/2)   | Bump the dependencies group with 14 updates                        |
| [#3](https://github.com/NerdOutInc/ai-shop-template/pull/3)   | Run browser Storybook and admin checks on every PR                 |
| [#4](https://github.com/NerdOutInc/ai-shop-template/pull/4)   | Keep Next patches compatible with patch updates                    |
| [#5](https://github.com/NerdOutInc/ai-shop-template/pull/5)   | Reject ambiguous store time zone values                            |
| [#6](https://github.com/NerdOutInc/ai-shop-template/pull/6)   | Restrict inherited Supabase browser privileges                     |
| [#7](https://github.com/NerdOutInc/ai-shop-template/pull/7)   | Keep test stores independent of merchant rebranding                |
| [#8](https://github.com/NerdOutInc/ai-shop-template/pull/8)   | Plan maintainable multi-brand store updates                        |
| [#9](https://github.com/NerdOutInc/ai-shop-template/pull/9)   | Remove prior-store checkout recovery namespace                     |
| [#10](https://github.com/NerdOutInc/ai-shop-template/pull/10) | Protect checkout capacity and preserve payment identity            |
| [#11](https://github.com/NerdOutInc/ai-shop-template/pull/11) | Remove source fixtures and strengthen template hygiene             |
| [#12](https://github.com/NerdOutInc/ai-shop-template/pull/12) | Make setup checks and provider guidance trustworthy                |
| [#13](https://github.com/NerdOutInc/ai-shop-template/pull/13) | Make storefront policies and optional features match configuration |
| [#15](https://github.com/NerdOutInc/ai-shop-template/pull/15) | Make brand configuration and website assets reliable               |
| [#19](https://github.com/NerdOutInc/ai-shop-template/pull/19) | Bump @supabase/supabase-js in the dependencies group               |
| [#20](https://github.com/NerdOutInc/ai-shop-template/pull/20) | Prevent existing accounts from being adopted during owner setup    |
| [#21](https://github.com/NerdOutInc/ai-shop-template/pull/21) | Wait for measurement requests instead of trusting networkidle      |
| [#22](https://github.com/NerdOutInc/ai-shop-template/pull/22) | Call the crop top a plain "Crop top" on its product page           |
| [#23](https://github.com/NerdOutInc/ai-shop-template/pull/23) | Focus the weekly home section on the week's products               |
| [#24](https://github.com/NerdOutInc/ai-shop-template/pull/24) | Email subscribers when the Design of the Week drops                |
| [#25](https://github.com/NerdOutInc/ai-shop-template/pull/25) | Record the reviewed source changes through 1082c12                 |
| [#26](https://github.com/NerdOutInc/ai-shop-template/pull/26) | Keep the Ruff cache inside the repository                          |
| [#27](https://github.com/NerdOutInc/ai-shop-template/pull/27) | Reconcile source ports and prevent duplicate Meta route views      |
| [#28](https://github.com/NerdOutInc/ai-shop-template/pull/28) | Separate owner configuration and preserve update compatibility     |
| [#29](https://github.com/NerdOutInc/ai-shop-template/pull/29) | Protect merged migrations and resolve forward-port references      |
| [#31](https://github.com/NerdOutInc/ai-shop-template/pull/31) | Prepare pinned template release metadata without publishing        |

The initial AI-first snapshot and its subsequent local-mail configuration commit are also included. Source-store changes are sanitized ports recorded separately in the source ledger; source consent/legal decisions are not inherited. The canonical template continues to use opt-in marketing consent.

## Configuration and compatibility

For a **new store**, keep owner values in `src/lib/store-config-values.ts`. The shared `store-config.ts` loader validates them. New/omitted activation flags default off; explicit owner settings survive. Policies, shipping confirmation, permanent commerce identity and retained-data disclosures still need that store's decisions. Both retained subscriber and email-record disclosures are required and remain true when corresponding data is retained, even with features disabled. Do not copy neutral values over an existing brand.

For an **existing store without an exact template origin**, this release is not a whole-store upgrade plan. Use individually reviewed scoped ports and the receiving store's actual schema. Never replay the template's fresh baseline, import unrelated history or rename applied files. A timestamp conflict needs a reviewed later forward migration, a canonical/local checksum mapping, dependencies and a deployment receipt. Migration-reference/history checks validate repository receipts; populated upgrade/failure CI remains future work after the manual rehearsal.

## Migration and deploy order

New empty databases apply the complete sorted migration set:

1. `20260928000354_storefront_baseline.sql`: fresh application schemas and explicit runtime/browser privileges.
2. `20260928030400_checkout_capacity.sql`: durable checkout admission/provider budget. Apply before code that uses it; preserve the receiving store's runtime role in any scoped port.
3. `20260928030931_commerce_identity.sql`: permanent payment identity. Resolve an existing store's established identity before adopting the matching code; a rebrand does not rotate it.
4. `20260928203733_verified_owner_enrollment.sql`: verified owner reservation. For a scoped existing-store update, disable owner setup/library or remove the bootstrap secret and deploy that pause before applying the migration. Deploy matching code, verify reservation/claim behavior, then re-enable. A consumed claim is not reset as a shortcut.
5. `20260930172137_drop_email_deliveries.sql`: additive outbox with a required frozen site origin. Apply before the matching code; sending stays off until the separately reviewed activation steps below. This can briefly lock subscriber writes while creating the foreign key.

For each receiving store, inspect applied versions and actual auto-deploy settings before choosing an order. Code merge and migration application are separate actions. Verify complete CI on the exact final head; if branch protection is unavailable, confirm it manually. Never merge deploy-triggering code before its required migration. Retain prior deployment recovery instructions and database evidence; rolling back app code does not undo applied SQL or erase retained data.

## Optional activation

Drop emails arrive with `DROP_EMAILS_ENABLED=false`. Keep them off while preparing sender/postal-address environment settings, provider configuration, reviewed retained-data disclosure, migration and authorized worker schedule. Follow [the six-step rollout](../drop-emails.md#rollout), then run `pnpm setup:check`, `pnpm setup:check --sandbox` for test configuration and `pnpm setup:check --launch` before a separately authorized live activation. Those checks leave remote readiness unverified. Disabled sending preserves the outbox, subscriber/unsubscribe history and required disclosures.

Other optional capabilities remain disabled until their owner decisions, prerequisites and verification are complete. Template release publication does not activate a store, connect provider accounts, authorize payment capture or send fulfillment to production.

## Validation evidence

The configuration boundary passed `pnpm check:all`: 3,920 unit tests, 139 Storybook interactions/accessibility tests, 348 public browser tests in desktop/mobile Chromium and WebKit, 28 publishing journeys and 9 local admin journeys with public signup disabled. Later tooling layers passed baseline checks including the database privilege suite, migration/architecture and release-preparation fixtures. Hosted CI additionally exercises admin Auth with both public-signup settings. These are local/disposable environments, not provider/deployment evidence. Verify the complete **Required checks** aggregate on the actual final release commit before publication; candidate branch tests do not establish that future commit's result.

## Publication and rehearsal gates

- Merge the compatibility/guard layers before creating any store; record the final source-port merge receipt and resolve candidate manifest follow-ups.
- Obtain authority for the tag/release. Use `template-v0.1.0`; do not enable immutable releases or change visibility/license without the owner's decision. Immutable tag names cannot be reused once that setting applies.
- Pin the final full commit, require its complete CI, recompute metadata and review the notes. Record a separately verified deployment receipt for any operating-store port.
- After approval for the rehearsal repository, use GitHub's template generator only while `main` exactly equals the verified R1 commit. Capture root/template commit and tree before customization. Between releases, keep `originRelease` null and record the exact commit; an earlier release is only a comparison anchor.
- R2 must contain a real subsequent fix. Do not withhold security fixes to manufacture practice material. Manually integrate R2 and an intentional conflict in one store. A repository-only exercise proves integration, not migration/deployment order or activation.
- Build permanent populated-upgrade CI and derive the store-update skill from that rehearsal before automation. No new provider project is part of the repository-only rehearsal.

Stores predating template #13 had no `features` object: About, Design of the Week and signup rendered unconditionally. Moving those literal values unchanged would now default all three off. Before deployment, explicitly preserve or disable each existing surface and record the owner's decision; absence is not evidence that the owner wanted it hidden. Historical commit-named fixtures record the old shapes and required disclosure/branding migrations.
