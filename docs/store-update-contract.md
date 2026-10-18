# Store provenance and update contract

Status: operating procedure for the [update strategy](store-update-strategy.md), with a local baseline-capture command and a recorded source-port review. Pinned release preparation is implemented; publication, cross-store update automation and the engine package remain separate future steps. A ledger is a receipt, not an automatic-update fairy.

## Record what was actually inherited

[Template origin](template-origin.md) is the canonical attribution and source-provenance record; [PR #11](https://github.com/NerdOutInc/t-shirt-shop-template/pull/11) adds its machine-readable extraction record. Preserve license notices and distinguish an extraction commit from a later comparison head. A downstream store records the template content baseline before customization; if unknown, leave it unknown and investigate without claiming a current release is already applied.

### Capture a generated store's baseline

[GitHub documents](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-repository-from-a-template) that a generated repository starts with the template's files and a new, unrelated history. Compare its root **tree**, rather than its new root commit SHA, with a verified local canonical-template history. This establishes content equivalence, not proof of which GitHub creation event produced it.

Before personalizing a new store, obtain a complete local template checkout, verify its origin and the full commit SHA to search through, then run this from the generated store's root:

```sh
node scripts/template/capture-store-baseline.mjs \
  --template-dir "$TEMPLATE_CHECKOUT" \
  --template-ref "$VERIFIED_TEMPLATE_COMMIT"
```

Set those variables to the trusted local checkout and verified full SHA first. For an older generated store without this command, run `node "$TEMPLATE_CHECKOUT/scripts/template/capture-store-baseline.mjs"` with the same arguments from that store's root. The command reads Git locally; it does not fetch, contact GitHub, import ancestry, alter refs or customize either store.

The command exclusively creates `docs/store-update-ledger.json`. Review and commit it before customization. It records the matching template commit/tree, generated root commit, search boundary, evidence method, initial `lastFullyIntegratedTemplateCommit` and `reviewedThroughTemplateCommit`, and any paths changed in already committed customization. Its `changes` and `deployments` arrays start empty: inherited content proves no deployment.

Capture refuses dirty stores, shallow history, multiple roots, shared ancestry, an existing ledger and unmatched trees. Retained-history clones record their independently verified starting template commit manually instead of treating the oldest repository root as their origin. More than one template commit can have the same tree, so identical content alone may be ambiguous. It refuses to choose in that case; supply `--template-commit FULL_SHA` only when independent creation evidence identifies a matching commit inside the searched history. Otherwise leave the baseline unknown. Even a unique match is limited to the supplied history boundary. Local synthetic fixtures test capture and refusal behavior; a fresh repository generated through GitHub's live UI has not been verified here.

The full release process has three distinct records and owners. Initial store-ledger capture and pinned candidate release manifests are implemented here; no release is published yet, and the deployment receipt format remains proposed:

| Record              | Minimum fields                                                                                                                                                                              | Owner and location                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Template release    | Tag, pinned commit/tree, PR inventory/receipts, migration/lockfile/notes digests, pending source follow-ups and publication blockers; compatibility and validation guidance in hashed notes | Maintainer; committed record/notes, generated local or Actions manifest; attach it to the authorized GitHub release |
| Store update ledger | Origin template SHA or unknown, last fully integrated release, reviewed-through release, accepted/skipped/deferred change IDs with reasons, local divergence paths, resulting store commit  | Store operator; versioned metadata in that store's repository                                                       |
| Deployment receipt  | Store alias, environment, engine/store commit, configuration commit/hash, schema revision, deployment ID, resource-identity verification time, validation result and outstanding action     | Operator; private deployment/operations record                                                                      |

A partial backport must not advance `last fully integrated release`. `Reviewed-through` means every change has a disposition, not that every fix is present. Deployment receipts distinguish prepared, PR-open, tested, merged, deployed, remotely verified and deferred states. Unknown is a useful answer; a green guess is not.

Do not put credentials, customer data, private owner details, grant files, artwork, webhook URLs carrying secrets, or another brand's resource IDs in public template metadata. Keep the opt-in cross-store inventory private and store only safe aliases and references. Retain authorized evidence in its original access boundary.

Apply the setup skill's canonical [authority and saved-progress rules](../.agents/skills/store-setup/SKILL.md#authority-and-saved-progress) to these records. They are evidence to reconcile with the owner's conversation, not an independent source of permission.

## Source-store ports

Extraction provenance answers where the template came from; [the source-port ledger](source-port-ledger.json) records which later source changes were considered. Keep it beside the provenance record, with full source/parent SHAs, paths, disposition, reason, evidence and any resulting template commit or tracked follow-up. The checked interval currently starts **after** accepted source commit `b32ab30dd7c74f3d17cb88b9dbf4111224cafe54` and ends at `3c7b7b1b88116bec2867bf6a4f3c8acdb775ccb2` (thirty-nine first-parent commits). The first nineteen, through `2926c59ca5823b3894b3404c05a5cadbd2d60b70`, were reviewed on 2026-10-02:

- `786b2a04101b89b500bee99a7b5bf739a18f39b9`: skipped; store-specific fixture labels, with no production behavior change.
- `779bc8e80e3cdb03edef80be8da3d38cfb3fc41b`: skipped; store-specific shop copy.
- `8fec64cfbc67c80d4f475d00948b08f98037218a`: accepted; plain "Crop top" product-page label for the seeded category.
- `0e358238c790b06df6e4a6fbff508afccf790e2d`: accepted; the weekly home section shows only the week's products and signup.
- `e5a521c2781783a13243986567f04b80160329b2`: skipped; opt-out ad measurement approved for one US-only store. The template keeps opt-in consent.
- `74040bc69a5bc3c6038bbbca5e6544a6f9eb3be0`: skipped; a test expectation for the skipped opt-out change.
- `7c3ce5d53a9baa69904df0b9bb6e2efd72106618`: already equivalent; the template already pins the same or newer packages.
- `7a32d108055dd562cc123d821dd693fc7eab02ee`: accepted; tracking tests wait for measurement requests instead of `networkidle`.
- `1082c1228ba50eb95c76ae30f0acdc201cf2dd89`: accepted; optional drop emails, off by default, merged in template #24.
- `0e400aeeb71362aee864ae53d859a90aff40db5d`: accepted; prevent duplicate SDK route views and recheck opt-in consent before cached-page restore.
- `932211050767be070064a9e0ec478d021a4227d0`: already equivalent; repository-local Ruff cache in template #26.
- `21bea1d10e28aae50a7c08db3c753e945ce18c01`: already equivalent; template #24 froze email origins from its first outbox schema.

The remaining seven source merges are accounted for in the ledger. The DOM-value signup fix and customer commerce journeys merged in template #36/#37; inbox confirmation, exact-email support, and erasure/expiry merged in #32/#33/#34. The two-person historical conversion stays source-specific. Erasure focus was already equivalent. The final source admission/worker/keyboard safety port and receiving focused CI hardening merged in #39; its receiving merge receipt is recorded. The template retains its aggregate Required checks gate, with focused PR and full main/weekly/manual scopes documented in [CI](ci.md). The ledger's `validationEvidence` records the full hosted result after the #40 admin fixture repair. Required source live confirmation/admin/scheduled-suppression proof remains an unresolved release-readiness follow-up in the subscriber rollout guides; merged code and synthetic CI do not establish it.

The next fifteen, through source PR #197, were reviewed on 2026-10-18. Template #53, #54 and #55 delivered nine selected ports (shipping and returns guidance, size feedback, raster font defaults, free shipping, Google Merchant copy and the responsive weekly hero); their merge receipts are recorded. Template #60 ports store-managed product galleries with a new `product_galleries` migration, Stripe Endive test hardening, and the neutral marketing-creative and weekly-hero guidance beneath two campaign commits. The Storybook bump was already equivalent through #59. The selected model cast, photo archive and replay scripts stay source-specific.

The next five source merges, through #203, were reviewed on 2026-10-18. The #200 unavailable-color accordion was superseded by the available-only picker in #202. Photography inspiration and centering guidance are already present through template #61 and #63; the source photo fixture and private operational receipts remain excluded. The current port adopts #202’s always-visible preview and shared color swatches, plus #203’s common matching-view selection, while preserving template keyboard focus, touch targets, neutral fixtures and API stories. These changes require no migration or provider setup.

Accepted entries name their template pull request until its merge commit is recorded in the ledger. This is a thirty-nine-commit review, not a claim that every historical or later source change, or any unmerged source work, has been audited. Before each template release, the maintainer checks the source's subsequent first-parent range with read-only access and records each change as accepted, already equivalent, skipped, deferred, conflict or unresolved. Accepted/equivalent entries need destination code and validation evidence; deferred/conflict/unresolved entries need an owner and follow-up. Advance `reviewedThroughSourceCommit` only across a contiguous accounted-for range, including any merged changes inspected within it. It never means every change was integrated. Keep private code, credentials and unreleased security details within their original access boundary.

### Send template fixes back before engine adoption

An existing operating store may have neither shared ancestry nor a template-origin SHA. It still receives relevant fixes through individual reviewed ports; do not postpone security or correctness fixes until stage 4 of the engine pilot.

1. Identify an affected behavior and regression control in the template. Pin the fix commit, its parent, the receiving store's current head and all required code/test/config/migration dependencies. An unknown whole-store baseline is acceptable for this explicitly scoped fix only after inspecting the receiving implementation and classifying it as affected, equivalent or not affected with evidence.
2. Prepare a private receiving-store receipt with `templateParentCommit`, `templateFixCommit`, `receivingHeadBefore`, selected paths, disposition/reason, receiving PR/resulting head, validation evidence and deployment state. Never mark its whole template baseline integrated because one fix was adopted. Track every affected inventoried store, even when the disposition is deferred.
3. From the trusted template checkout, create a scoped patch using `git diff --binary --full-index "$FIX_PARENT" "$FIX_COMMIT" -- <reviewed-paths>` and save it in private local staging. In an authorized isolated receiving-store branch, run `git apply --check "$PORT_PATCH"`. If it passes, apply and inspect the patch; if it fails, adapt the behavior manually against the receiving code. Do not import source history, force a patch, replace whole files or replay the fresh database baseline.
4. Preserve brand configuration, existing schema history, commerce identity and pending receipts. Reproduce the regression, verify the fix and relevant failure controls on the receiving head, then open its draft PR with the receipt. Merge, migrations and production deployment retain their separate authority and verification steps.

The local Git fixture verifies clean patch application and rejection of overlapping brand edits across unrelated histories. It does not prove runtime compatibility in an operating store. This change performs no outbound port; the ledger's empty `outboundPorts` array records that boundary. The release maintainer should schedule the stage-4 assessment **before onboarding a second operating owner brand, or when a required shared fix cannot be ported without a schema transition, whichever comes first**. That trigger starts an assessment; it does not authorize migration or delay an urgent fix.

## Prepare a clone update

1. Verify the receiving repository, branch, baseline and current tree. Preserve local work. Create an isolated branch in that repository; never use a production database while preparing an update.
2. Review changes between the recorded template release and the target release. For an unknown baseline, inventory files and previously adopted changes first. Never replay all historical source-store commits or import that repository's private history.
3. Classify every change as required fix, optional feature, irrelevant, already equivalent, conflict or unresolved. Review dependencies across code, configuration, migration, script, skill, docs and tests; a clean patch is only a textual result. Required security fixes cannot be silently categorized as optional.
4. Prepare the smallest complete forward port against the receiving store's history. Use a three-input comparison: recorded template baseline, target template release and current store tree. Patch preparation may be automated for unchanged paths; overlapping edits, renamed/deleted files, config, migrations and lockfiles need explicit treatment. No broad source-tree overwrite, unrelated-history merge or “take theirs.”
5. Protect the store's configuration, approved public assets, deployment/workflow settings and operational identities. Reconcile dependency manifests with the pinned package manager and regenerate the lockfile deliberately. Review workflow permissions before executing new upstream workflow code.
6. Open a draft PR inside the store repository with source release/commit references, accepted and omitted changes, compatibility notes, test results and the updated ledger. Partial updates enumerate missing fixes. Human review resolves conflicts; approval to prepare a PR does not authorize merge or deployment.

The first automation should produce a **candidate** PR and a conflict report, using narrowly scoped repository permissions. It must fail closed on an unknown baseline or overlapping edits and never rewrite store branches, edit secrets, apply database migrations or auto-merge. Validate it against an unchanged clone and a clone with intentional edits to the same file before enabling it for an owner repository. Dependabot continues to update dependencies, but does not distribute application fixes or replace this process.

Do not turn historical renames into a blanket substitution script. A role prefix, payment idempotency prefix, metadata identity, theme color and ordinary product copy have different compatibility requirements. Any future transformation map must be path-scoped, reviewed, idempotent and tested against deliberate nonmatches; refuse unrecognized input. Reject source-brand copy and private identifiers during port review with the maintained hygiene checks. Keep Dependabot in independent clones; only engine consumers with no independent application dependencies can centralize application dependency updates, while still updating their own workflow/tool dependencies.

## Release and security propagation

Maintain a private, opt-in inventory for centrally operated brands: operator, current deployed receipt, adopted template/engine release, supported schema/config range, exposure to optional capabilities, pending security fixes and next action. Independent owners receive published release notes and choose their operator; the template has no phone-home inventory or automatic access to generated repositories.

For each reusable fix:

1. The maintainer determines affected releases/capabilities, creates the regression control, and fixes the canonical template/engine. For a private security issue, coordinate privately before disclosing exploit details; public notes still identify affected/fixed releases when released.
2. Publish an immutable release from the tested commit, including upgrade order and whether the old app remains compatible after migrations. Start with a clearly declared supported release line; add backport lines only with a named maintainer and test coverage. Uninventoried clones are not presumed patched or supported.
3. Create or track an update PR for **every inventoried affected store**. For engine consumers, change the pinned engine/config release; for clones, prepare the reviewed forward port. Apply urgent security triage immediately rather than waiting for the normal feature batch. Record an operator and target date per affected store instead of promising an unstaffed universal SLA.
4. Run the required suite on the exact receiving head. The release operator verifies the intended account/project/environment, schema plan and rollback target. Use a sandbox/canary first, then separately authorized production rollout per brand. Do not permit an engine merge to become a fleet-wide promotion.
5. Read back the deployed commit/build and exercise the affected behavior. Close propagation only when every affected inventory row is remotely verified, explicitly not affected with evidence, or visibly deferred with an owner and compensating action. PR creation, merge and deployment are three different receipts.

Release notes alone do not repair existing stores. A feature flag that hides a page also does not mitigate a vulnerable route unless the server boundary actually denies it. Disabled capabilities must retain denial tests, and fixes must cover both enabled and disabled states. Separately test the documented handling of already accepted work: disabling an entrypoint must not erase paid orders, discard uncertain receipts or silently reinterpret a saved reveal schedule.

## Schema and recovery rules

The template's [`20260928000354_storefront_baseline.sql`](../supabase/migrations/20260928000354_storefront_baseline.sql) creates a fresh database. It is **not** an upgrade migration for an operating store. Never reset, recreate, replay the baseline over, or replace an existing ledger to make histories match. Preserve original migration files/checksums in stores that have already applied them.

New incremental migrations must declare preconditions, compatible app versions, retry behavior, lock/runtime expectations and verification queries. Test both a fresh install and an upgrade from every supported prior schema. Prefer additive expansion, compatible application rollout and later cleanup; destructive contraction needs a separate reviewed recovery plan. Keep one migration operator per target and record actual applied state. [Supabase's migration workflow](https://supabase.com/docs/guides/deployment/database-migrations) explains migration-history coordination; it does not make unrelated histories interchangeable.

Rollback must account for database and provider side effects. Redeploying an older app is valid only if that app supports the now-current schema and persisted order format. A database restore can erase order receipts while Stripe payments and Printify orders still exist; it is not a routine undo button. Stop new affected work when necessary, preserve durable claims/events, reconcile uncertain external operations, and apply a reviewed forward fix. Use [order recovery](../.agents/skills/store-order-recovery/SKILL.md) and [publishing recovery](../.agents/skills/store-publishing-recovery/SKILL.md).

## Acceptance evidence for an update

Use `package.json` and current CI as the command authority. Run the documented PR CI suite before merge, with every required database/browser job actually executed. Run `pnpm check` and full verification before production release. `pnpm check:all` is the local full suite; a skipped database test is not a pass. Report infrastructure failures separately from behavior failures. Keep existing static hygiene, setup and permission checks useful for both clone and engine paths.

For relevant changes, include these controls:

- Brand preservation: public identity/assets, shipping/policies, metadata, feeds and feature settings retain the owner's intended values. Test both a neutral unconfigured store and a configured second-brand fixture.
- Security/isolation: restricted runtime role, browser denial, admin/grant revocation, foreign-brand IDs and signed callbacks. No copied real credentials or production data in fixtures.
- Commerce/recovery: test payment cannot manufacture; replay does not duplicate orders; timeout/retry preserves pending claims, checkout identity and publication provenance. Check old persisted records against the new code.
- Deployment: distinct preview and production resources, correct build configuration, unchanged unrelated brand, upgrade and permitted app rollback. UI changes include narrow/wide viewports, keyboard and focus evidence.

The PR receipt names the exact head, passed/failed/skipped checks, upstream changes accounted for, schema/config requirements and remaining release action. A remotely verified release adds its deployment receipt; configuration checks alone never establish live payments, fulfillment, artwork delivery or merchant acceptance.

## Owner configuration compatibility

Edit public owner values in `src/lib/store-config-values.ts`. `store-config.ts` remains the template-owned loader; consumers keep importing it, and validation/defaults stay in `store-config-schema.ts`. During an update from the earlier single-file shape, move the receiving store's exact literal values into the data file before adopting the loader. Do not copy the neutral template values over a configured brand.

Omitted feature activation flags resolve to false; explicit true/false owner choices survive. New activation flags must follow this rule and be tested against the append-only, commit-named historical configuration fixtures. For a store predating the feature flags (before template #13), About, Design of the Week and signup previously rendered unconditionally. Moving a flag-free config unchanged would disable them. Explicitly decide and record all three existing feature values before deploying that update; missing flags are suitable defaults for newly introduced capabilities, not evidence of an old store's choices. New policy, identity or retained-data fields require review rather than an invented safe answer. In particular, supply both retained subscriber and delivery-record disclosures from that store's actual retained data, and preserve its permanent commerce identity. Missing disclosures fail validation even when sending is disabled. The shirts can be optional; the privacy facts cannot.

Setup, hygiene and browser fixture generation use the owner-data file. Hygiene still scans working and staged content independently and never executes owner code; older single-file stores retain the static inspection path. Run `pnpm setup:check` and the full suite after moving owner values. The config split must merge before generating a new store so that every future update preserves this boundary.

The example signup-confirmations worker schedule moved from `*/15 * * * *` to `10,25,40,55 * * * *`, keeping it clear of the hourly and half-hourly workers and drop emails. Adopting it is an optional receiving-store schedule change: `pnpm setup:check` accepts both values, so a store that already merged `*/15` stays valid. Changing an active `vercel.json` schedule still requires separate deployment authority.

Static hygiene now recognizes both historical `storeSchema.parse({...})` and the actual `storeConfigSchema.parse({...})` spelling. The earlier detector missed the latter, so configured single-file stores now receive the configured-store hygiene scope rather than neutral-template fingerprints. Configuration parsing and brand-isolation checks still apply.

## Migration identity and forward-port receipts

`pnpm check:migration-history` protects SQL filenames and bytes already in the prior Git snapshot, checks both working and staged content, and rejects new migrations at or before its latest timestamp or with duplicate timestamps. Its local default is `origin/main`; fetch the receiving repository's current base, or supply `pnpm check:migration-history --base FULL_BASE_SHA`. Missing history fails closed even before a first push; use `MIGRATION_BASE_REF=FULL_BASE_SHA pnpm check` with a reviewed local baseline when no remote exists. CI fetches full history and selects the PR base, merge-group base or push's previous commit; a manual run compares against its checked-out commit. Only a first push with GitHub's all-zero `before` value has no prior history to protect. The ordering result is advisory against its tested base unless [up-to-date branches or a merge queue](ci.md#required-merge-gate) are enforced. Without that setting, update against the latest target and confirm it has not advanced after the required PR checks, immediately before the authorized merge. The check does not inspect a provider's applied-migration table: read that separately before preparing a rollout.

Keep already applied files intact. An adopted canonical migration can keep its name only when it follows the receiving history safely. Otherwise add a later receiving-store forward migration and append a receipt to `migrationMappings` in `docs/store-update-ledger.json`:

```json
{
  "canonicalFilename": "20260930172137_drop_email_deliveries.sql",
  "canonicalSha256": "<SHA-256 of canonical SQL at templateCommit>",
  "templateCommit": "<full pinned template commit>",
  "localFilename": "YYYYMMDDHHMMSS_drop_emails_forward.sql",
  "localSha256": "<SHA-256 of reviewed local SQL>",
  "reason": "The receiving store has later migrations; this forward port preserves its runtime role and existing data."
}
```

This is a shape example, not a ready-to-apply migration or valid checksum receipt. Capture the canonical hash from the pinned template snapshot and verify it against that release's manifest. Review any semantic adaptation, dependencies, transaction behavior and deploy order. The local hash must match the actual SQL bytes. Receipts are append-only after merge; do not revise an old mapping or checksum to conceal a migration edit. Record a correction in a new forward migration and update receipt instead.

`pnpm check:migrations` validates the map and accepts a missing canonical filename when its reviewed local copy exists and matches the recorded hash. It also recognizes correctly resolved canonical Markdown paths. It rejects malformed receipts, unsafe paths, symlinks, checksum mismatches, duplicate/chained aliases and a canonical file coexisting with its alias. A wrong-depth Markdown link still fails. Canonical docs and skills can retain their names across later updates; when applying SQL, use the mapped **localFilename**, not the canonical link. Canonical filenames, canonical hashes and template commit IDs are self-attested fields: local checks do not look them up upstream or authenticate a release manifest. A fabricated canonical receipt can satisfy a dangling reference, so a reviewer must independently compare that half against the pinned template/release before accepting it. Future manifest-backed validation requires a trusted release artifact, not another unchecked local assertion. This is reference validation, not proof that the canonical bytes were independently fetched, that SQL is equivalent, or that a migration was deployed.

Baseline capture initializes empty mapping/deployment arrays and null release fields. It records exact commit/tree identity without guessing a release. After verifying an exact published release match, record `originRelease`; otherwise keep it null and use a verified earlier release only as `comparisonRelease`. A store created between releases retains its exact origin commit as the integration anchor.
