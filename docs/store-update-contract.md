# Store provenance and update contract

Status: proposed operating contract for the [update strategy](store-update-strategy.md). This repository currently has no cross-store update bot, release inventory service or engine package. The fields below specify the first implementation; they are not existing commands or an assurance of automatic support.

## Record what was actually inherited

[Template origin](template-origin.md) is the canonical attribution and source-provenance record. Preserve license notices and distinguish a verified extraction commit from a later comparison head. A downstream store records the exact template commit used to create it; if unknown, record `unknown` and reconstruct it by reviewed file comparison. Never guess from creation time or mark a current template release as already applied.

Proposed records have three distinct owners:

| Record              | Minimum fields                                                                                                                                                                             | Owner and location                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Template release    | Version, full commit/tree SHA, release date, supported config-schema version, migration IDs/checksums, dependency lock hash, compatibility/rollback notes, test evidence                   | Maintainer; committed non-secret release metadata and GitHub release |
| Store update ledger | Origin template SHA or unknown, last fully integrated release, reviewed-through release, accepted/skipped/deferred change IDs with reasons, local divergence paths, resulting store commit | Store operator; versioned metadata in that store's repository        |
| Deployment receipt  | Store alias, environment, engine/store commit, configuration commit/hash, schema revision, deployment ID, resource-identity verification time, validation result and outstanding action    | Operator; private deployment/operations record                       |

A partial backport must not advance `last fully integrated release`. `Reviewed-through` means every change has a disposition, not that every fix is present. Deployment receipts distinguish prepared, PR-open, tested, merged, deployed, remotely verified and deferred states. Unknown is a useful answer; a green guess is not.

Do not put credentials, customer data, private owner details, grant files, artwork, webhook URLs carrying secrets, or another brand's resource IDs in public template metadata. Keep the opt-in cross-store inventory private and store only safe aliases and references. Retain authorized evidence in its original access boundary.

## Prepare a clone update

1. Verify the receiving repository, branch, baseline and current tree. Preserve local work. Create an isolated branch in that repository; never use a production database while preparing an update.
2. Review changes between the recorded template release and the target release. For an unknown baseline, inventory files and previously adopted changes first. Never replay all historical source-store commits or import that repository's private history.
3. Classify every change as required fix, optional feature, irrelevant, already equivalent, conflict or unresolved. Review dependencies across code, configuration, migration, script, skill, docs and tests; a clean patch is only a textual result. Required security fixes cannot be silently categorized as optional.
4. Prepare the smallest complete forward port against the receiving store's history. Use a three-input comparison: recorded template baseline, target template release and current store tree. Patch preparation may be automated for unchanged paths; overlapping edits, renamed/deleted files, config, migrations and lockfiles need explicit treatment. No broad source-tree overwrite, unrelated-history merge or “take theirs.”
5. Protect the store's configuration, approved public assets, deployment/workflow settings and operational identities. Reconcile dependency manifests with the pinned package manager and regenerate the lockfile deliberately. Review workflow permissions before executing new upstream workflow code.
6. Open a draft PR inside the store repository with source release/commit references, accepted and omitted changes, compatibility notes, test results and the updated ledger. Partial updates enumerate missing fixes. Human review resolves conflicts; approval to prepare a PR does not authorize merge or deployment.

The first automation should produce a **candidate** PR and a conflict report, using narrowly scoped repository permissions. It must fail closed on an unknown baseline or overlapping edits and never rewrite store branches, edit secrets, apply database migrations or auto-merge. Validate it against an unchanged clone and a clone with intentional edits to the same file before enabling it for an owner repository. Dependabot continues to update dependencies, but does not distribute application fixes or replace this process.

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

Use `package.json` and current CI as the command authority. Run `pnpm check` and the full CI suite before merge, with every required database/browser job actually executed. `pnpm check:all` is the local full suite; a skipped database test is not a pass. Report infrastructure failures separately from behavior failures. Keep existing static hygiene, setup and permission checks useful for both clone and engine paths.

For relevant changes, include these controls:

- Brand preservation: public identity/assets, shipping/policies, metadata, feeds and feature settings retain the owner's intended values. Test both a neutral unconfigured store and a configured second-brand fixture.
- Security/isolation: restricted runtime role, browser denial, admin/grant revocation, foreign-brand IDs and signed callbacks. No copied real credentials or production data in fixtures.
- Commerce/recovery: test payment cannot manufacture; replay does not duplicate orders; timeout/retry preserves pending claims, checkout identity and publication provenance. Check old persisted records against the new code.
- Deployment: distinct preview and production resources, correct build configuration, unchanged unrelated brand, upgrade and permitted app rollback. UI changes include narrow/wide viewports, keyboard and focus evidence.

The PR receipt names the exact head, passed/failed/skipped checks, upstream changes accounted for, schema/config requirements and remaining release action. A remotely verified release adds its deployment receipt; configuration checks alone never establish live payments, fulfillment, artwork delivery or merchant acceptance.
