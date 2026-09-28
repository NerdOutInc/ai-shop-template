# Bounded pilot for one engine and several brands

Status: implementation plan for review, not an implemented platform. [The ADR](store-update-strategy.md) recommends this trial only after the current template is hardened and [clone updates](store-update-contract.md) have a recorded baseline. The initial PR contains documentation only. Any engine refactor begins after the coordinator reviews this plan; any paid resources or production migration require their own applicable authority.

## The smallest useful boundary

Keep this repository as the canonical single-store Next.js application and complete GitHub template. A trial branch adds a validated build input for public brand configuration and approved public assets. The neutral input remains the default, so a new owner can still click **Use this template**, clone the whole app and follow the existing setup skill.

Centrally operated brands would stop carrying independent copies of application files. Each owns a small configuration/asset repository or an access-controlled equivalent, plus a deployment record that pins a full engine commit and full configuration commit. Build a fresh workspace from those two inputs, run validation, and deploy to that brand's Vercel project. Do not use a floating branch or mutable tag as the deployment identity. The exact artifact format and config loader are pilot decisions, not new commands available today.

```text
Canonical engine commit + one brand configuration commit
                           |
                 isolated build and tests
                           |
                 one brand Vercel project
                           |
          that brand's database, Auth and provider resources
```

Two brands may use the same engine release while retaining separate build outputs, secrets, databases, domains, storage, callbacks, schedules and release dates. The server process still serves one store. There is no shared tenant database, hostname-to-secret router, Stripe Connect marketplace or private-artwork export in this proposal.

Use a separate Printify merchant account and shop per brand for credential and rate-budget isolation. Several shops under one account remain one trust/quota boundary even with separate tokens. An existing shared account needs an explicit risk decision, not a silent account migration. The [operations guide](store-operations-costs.md) separates this boundary from shared Vercel/Supabase billing and includes the mandatory worker schedules in the budget.

## Contract to prove before extracting more code

| Input/boundary            | Proposed behavior                                                                                                                   | Required failure control                                                                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public brand config       | Versioned schema for identity, theme, content, commerce policy and supported feature choices; validate before build                 | Reject missing/unknown schema version and invalid policy/shipping combinations; never fall back to another brand                                                           |
| Brand selection           | One explicit build input; neutral input only for intentional template/unconfigured builds                                           | Missing production selection fails; a request header/domain cannot switch the selected brand                                                                               |
| Public assets             | Allowlisted approved public files with hashes; render only selected brand assets                                                    | Reject traversal, missing assets and private-source paths; no copy of another brand's assets into output                                                                   |
| Secrets/provider identity | Remain project/environment scoped outside the config bundle and client output                                                       | Foreign-brand project/shop/account and environment mismatches stop deployment; no live secrets on PR runners                                                               |
| Feature choices           | Use the canonical store configuration once the storefront work lands; distinguish capability from environment readiness and consent | Disabled new entrypoints deny at their server boundary; already accepted work follows its documented drain/reconciliation policy; hiding navigation alone fails acceptance |
| Application identity      | Persist the store's existing commerce identity and retry/deduplication keys                                                         | A display-name change cannot alter the identity of a pending payment or provider order                                                                                     |
| Release compatibility     | Engine commit, config-schema version, migration IDs and lockfile travel as one tested release                                       | Incompatible config/schema rejects before release; app rollback is refused when the declared schema range excludes it                                                      |

At the assessed baseline, [`store-config.ts`](../src/lib/store-config.ts) co-locates validation and values. The coordinated portability change extracts `src/lib/store-config-schema.ts` with `storeConfigSchema` and supplies complete validated test fixtures; production keeps its merchant-editable config, and fixture selection remains in the test harness. Reuse that seam after it lands, preserving import ownership and keeping test code out of production. The pilot still needs an explicit production build-input contract; test aliases alone do not implement one. Do not create a generic plugin system or dynamically load application modules. Keep secrets in [`env.ts`](../src/lib/env.ts) and server-only services. Public config must not acquire provider tokens because a build tool makes them convenient to access.

The coordinated storefront proposal uses independent `storeConfig.features.designOfTheWeek`, `dropSignup` and `about` booleans, defaulting to false; cadence remains in `weeklyFeature`. Reuse the reviewed canonical fields once that change lands. Disabling the weekly feature does not cancel already saved product reveals: an operator must deliberately cancel those schedules if cancellation is intended. Likewise, disabling a capability must not discard paid orders or uncertain publication receipts. Test both denial of new work and safe completion/recovery of existing work.

[Next.js inlines public environment variables during build](https://nextjs.org/docs/pages/guides/environment-variables). Build separately for each brand and intended environment, including canonical origin and public Blob hostname. Never take brand A's artifact and swap server secrets to make brand B. A preview passing with preview public values does not validate an unchanged artifact for production.

The target production design uses a protected release workflow that selects explicit engine/config commits and the intended brand project. Automatic production promotion from engine `main` must be disabled or isolated before adoption. Preview builds use sandbox resources and no manufacturing credentials. Verify the chosen Vercel CLI/project-linking and environment behavior during the pilot; this document does not claim that controller exists.

## Implementation-ready follow-ups

Keep these separate reviewable changes. Do not scaffold all of them before the first seam is proven.

| Follow-up                    | Scope and owner                                                                                                                                                                 | Acceptance / stop condition                                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Release baseline          | Maintenance owns `docs/template-provenance.json` and template-origin attribution; release maintainer adds the release and store-ledger records described in the update contract | Known full SHAs, license attribution, explicit unknowns and no private operational data; an intentional conflict is reported, not overwritten                                          |
| B. Build config seam         | Engine maintainer, coordinated with storefront config owner                                                                                                                     | Neutral, synthetic A and synthetic B pass the same schema; public output is correct; missing/invalid selection fails; existing setup tests still work                                  |
| C. Two-brand harness         | Engine maintainer and security reviewer                                                                                                                                         | Separate temporary databases, ports and output directories; one engine fix tested in both; deliberately swapped identities/config cause failure; teardown touches only owned resources |
| D. Release-pinning rehearsal | Release maintainer                                                                                                                                                              | Move A from release N to N+1 while B remains N; record exact receipts; rejected/failed A rollout cannot alter B; compatible app rollback and migration failure/retry are exercised     |
| E. New-brand sandbox         | Brand operator after review of B–D and resource/cost approval                                                                                                                   | Separate Vercel/Supabase/Auth/Stripe sandbox/Printify/Blob identities verified; callback replay and simulated fulfillment pass; production remains a separate decision                 |
| F. Existing-store assessment | Existing-store owner, database operator and release maintainer                                                                                                                  | Read-only inventory and a store-specific transition/recovery plan; no automatic data migration or new provider products                                                                |

Use synthetic fixture brands with deliberately different names, colors, policy text, time zones, schedule values, origins, shipping amounts and feature choices. Keep paid services and real credentials out of B–D. Existing near-term security, CI, checkout and setup fixes should land as normal single-store changes; they become shared engine behavior without being rewritten around speculative abstractions.

The go/no-go test is practical: can a developer change engine behavior once, produce correct builds for both brands, and roll out independently with no per-brand application-code patches? Track patch count, maintainer time, build/test duration and recovery results for the exercise. If a small configuration seam cannot express the real brand differences, keep clone updates and document the exceptions. Do not call a central repository plus a growing pile of brand conditionals a successful engine.

## Existing stores, including Knot a Gang

This work does not migrate an operating store. That store's source has different Git and migration histories; importing its data or running the template baseline is unsupported by the current setup workflow. A later, explicitly authorized adoption starts with a read-only inventory of its deployed commit, database schema/history, identity, customization, routes, callbacks, workers, Auth/passkeys, grants, provider resources and pending work.

The default migration hypothesis is **replace application code while retaining that store's resources**, not move customer data into a shared platform. It must be proved by a compatibility report. Compare schemas and applied migration checksums, map custom behavior to config or retained features, and design any additive transition separately. Never mark a migration applied solely to silence a CLI mismatch. Preserve original migration history and record any adoption checkpoint only after an independently verified schema-equivalence check.

Rehearse against a synthetic schema/data fixture representing the existing store's constraints. Real customer/artwork data is unnecessary for the initial pilot. A later restore rehearsal requires separately authorized access and private storage, with evidence kept outside this template. Preserve order/payment/Printify identities, admin membership and consumed owner claim, scoped grants, catalog receipts, immutable artwork revisions, favorites and publication fingerprints. A new engine is not permission to recreate products or reset pending work.

The cutover plan must name the write/worker freeze or other concurrency control, treatment of in-flight checkouts and signed webhook retries, migration operator, smoke checks, rollback compatibility and recovery owner. Keep the permanent domain and provider identities unless a separate change is approved; verify passkey/auth origin continuity. Never let old and new independent workers both manufacture an order. Retain the old deployment for an app rollback only where schema and persisted-state compatibility allow it. External payments and manufacturing are reconciled, not undone by restoring a database.

## When a package would be justified

Reconsider a versioned package only if two independently maintained app shells need the same stable behavior. Start with a real narrow consumer boundary and document framework peer versions, client/server entrypoints, migration and asset ownership, release provenance and installation tests. A package must preserve `server-only` and client directives, avoid exposing credentials through exports, and remain compatible with repository import rules. Treat code, migrations and operational workflows as a coordinated release even if they are distributed separately.

Until then, distributing the complete pinned application plus validated per-brand build input solves more of this store's actual update problem than packaging a few helpers. No registry, paid service, tenant abstraction or additional runtime is required merely to approve this plan.
