# ADR: Shared store updates without shared store data

Status: proposed for maintainer review. This document authorizes no engine extraction, hosting change, provider activation or existing-store migration. The implementation boundary and acceptance criteria are in [the engine pilot](store-engine-pilot.md); the immediate operating procedure is in [the update contract](store-update-contract.md).

## Recommendation

Keep **Use this template** as the supported starting point for independent owners. Make this repository the canonical home for reusable store behavior, publish identifiable releases, and deliver reviewed update PRs to participating clones. Stop treating a production brand repository as the default place to develop every shared feature.

For the owner's multiple brands, next prove a single application engine with separately pinned brand configuration and separate deployments. Adopt it only if a two-brand trial demonstrates that one engine fix reaches both brands without editing application code in either brand. Keep the template usable as a complete standalone application. Defer a published shared package until there is a stable boundary and a real independent consumer.

This order reduces hand-port work now without making existing stores the test subjects. The shirts may be experimental; the order ledger should be boring.

## Evidence behind the decision

This assessment pins template `d498dd3fb8b0e1c84b980b9cf35a42007ec7e04f` and source `779bc8e80e3cdb03edef80be8da3d38cfb3fc41b`. Source identity and extraction provenance belong in [template origin](template-origin.md); the current source head must not be relabeled as an established extraction base.

| Observation          | Verified result                                                                                                                                    | Implication                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Template history     | Two reachable commits: initial snapshot `3379d7b8daec011d168d2ae866b56fdf1e15d035`, then mail configuration                                        | Two commits are not evidence of two squash operations.                                        |
| Source activity      | 66 commits by committer timestamp in `[2026-09-14T03:00:00Z, 2026-09-28T03:00:00Z)`, reachable from the pinned source head; none are merge commits | Shared behavior changes frequently enough to warrant a release process.                       |
| Shared-path activity | All 66 touch at least one exact path tracked at the pinned template head                                                                           | The external review's 64 is not reproduced under this definition.                             |
| Tree overlap         | 863 paths occur in both trees; 524 have identical blobs and 339 differ                                                                             | 39.28% is shared-file content divergence, **not** a measured patch failure rate.              |
| Migration history    | Source has 28 migration files; template has one fresh-schema baseline; no migration paths match                                                    | Fresh setup and existing-store upgrades require different plans.                              |
| Git ancestry         | No merge base between the pinned heads                                                                                                             | Ordinary ancestry-based merging cannot identify which extraction transformations to preserve. |

The quoted 39% patch-failure claim remains unverified. Reproducing it requires the original commit sample, target snapshot, filters, patch options and classification of already-applied changes. Replaying pre-extraction patches against their extracted endpoint is not a prospective update experiment.

Reproduce the activity metric with read-only Git: list `git log SOURCE_SHA --format='%H%x09%cI%x09%P'`, filter the half-open timestamp interval above, inspect each parent-to-commit path set with `git diff-tree --no-commit-id --name-only -r PARENT COMMIT`, and intersect with `git ls-tree -r --name-only TEMPLATE_SHA`. Compare blob IDs from `git ls-tree -r` for tree overlap; that counts files, not compatible behavior. Use authorized source access, and keep private source contents out of public reports.

Current source boundaries also matter:

- [`store-config.ts`](../src/lib/store-config.ts) validates public brand content but defines it in the same module as the schema. It is a useful seam, not an implemented multi-brand loader.
- [`env.ts`](../src/lib/env.ts) and [`get-commerce-services.server.ts`](../src/features/checkout/get-commerce-services.server.ts) configure one store's provider services per process. The latter caches one service instance. A request hostname must never choose another brand's secrets inside that process.
- Routes, migrations, scripts, skills and tests are part of the product. For example, source DB-lifecycle change `79ffe808` crosses dependencies, shared helpers and checkout; publication change `e43dfc3f` crosses 15 paths; consent change `cf5466b5` crosses 54. Extracting a helper package alone would leave much of the update burden behind.

## Options

| Option                            | Update mechanism                                                                                                            | Benefits                                                                                    | Costs and constraints                                                                                                                               | Decision                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Independent template clones       | Release-to-release changes become branches and PRs inside each store repository, with explicit baseline and conflict review | Keeps ownership, arbitrary customization and today's onboarding; no new runtime service     | Application differences accumulate; each store still needs testing, migration and release evidence                                                  | Support now; automate candidate PR preparation after the manual contract works        |
| One engine, separate brand builds | Pin an immutable engine commit plus brand-config commit; build and release separately to each Vercel project                | A shared fix has one implementation; version pins and staged rollout isolate release timing | Central maintainership, build orchestration, config compatibility and per-brand release tracking become required                                    | Preferred next trial for centrally operated brands; not yet a production architecture |
| Versioned shared package          | Each app pins a package version and updates its lockfile                                                                    | Useful for independently evolving app shells or genuinely reusable pure logic               | Next.js routes, server/client directives, framework peers, migrations, assets, CLI tools and skills still need distribution and compatibility rules | Defer; extract only after two consumers prove a narrow boundary                       |

[GitHub template repositories start with independent history](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-repository-from-a-template). Adding an upstream remote does not create ancestry or an automatic update subscription. An update bot may open a branch in the receiving repository; it cannot rely on a cross-repository PR between unrelated histories. Forcing an unrelated-history merge would also import unwanted history and is outside this contract.

[Vercel supports multiple projects attached to one repository](https://vercel.com/docs/projects). That makes separate brand builds feasible, but is not a rollout controller: [a connected push can build multiple projects](https://vercel.com/docs/monorepos/monorepo-faq). The pilot must prove explicit version selection and prevent a merge to engine `main` from promoting every brand.

## Ownership and staged adoption

| Stage                                   | Deliverable                                                                                              | Exit evidence                                                                                                   | Accountable role                                         |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 0: Harden the current template          | Security, setup, CI, portability and provenance fixes, independently reviewable                          | Exact-head CI and source attribution; fresh setup retains neutral defaults                                      | Template maintainer and each change's reviewer           |
| 1: Make clone updates repeatable        | Release record, opt-in store inventory, one representative update PR and an intentional-conflict control | Update preserves brand configuration; conflicting changes require review; accepted/skipped changes are recorded | Release maintainer; store owner accepts its release      |
| 2: Prove the engine boundary            | Two synthetic brands, one pinned engine, separate fixture databases and builds                           | Cross-brand isolation, upgrade/rollback and one-fix/two-build exercise pass                                     | Engine maintainer with security and storefront reviewers |
| 3: Pilot a new owner brand              | A separately approved non-production deployment with its own resources                                   | Sandbox receipts and deployment identity are verified; all costs and operational ownership are explicit         | Brand operator and release maintainer                    |
| 4: Consider an operating-store adoption | Store-specific inventory, schema transition and recovery rehearsal                                       | Reviewed compatibility report and separate production authorization                                             | Existing store owner; database and release operators     |

The independent-owner route does not disappear if stage 2 succeeds. Keep the neutral profile, docs, skills and fresh-database tests in the canonical repository, and release template snapshots from the same engine source. A generated clone may customize freely; its divergence and support status must remain visible. Brand-specific fixes can originate in a brand repository during an incident, then return as sanitized reusable changes with regression coverage and attribution. Do not require access to another brand's private repository to update a new store.

## Cost and operational tradeoffs

One engine reduces duplicate development and conflict review; it does **not** collapse the brands into one bill or one release. Continue separate Supabase projects/Auth, Stripe accounts, Printify shops, public/private Blob stores, domains, Vercel projects, secrets and monitoring. Provider organizations may be shared where appropriate; resource identity and permissions remain brand-specific. This follows the existing [setup isolation contract](store-setup.md).

Budget for each brand's database capacity/backups, builds, storage/egress, email, monitoring and provider usage, plus shared CI and maintainer time. More projects and build targets can consume more plan quota; confirm current plans before provisioning. No pricing or savings estimate is established by this ADR. Compare measured engineering time per update and release failure/recovery time alongside hosting spend, not merely the count of repositories.

A common engine increases correlated-defect risk even with separate databases. Canary one explicitly chosen brand, pause on a regression, and record which releases actually reached each brand. A pin controls deployment timing; it is not evidence that a security fix was installed. The [update contract](store-update-contract.md) defines that distinction.
