---
name: store-launch-verification
description: Audit launch readiness or diagnose environment and deployment failures in this Printify and Stripe storefront. Verify source, preview, production, and provider evidence separately; use for launch checks, unavailable catalog or checkout, and deployment configuration issues.
---

# Verify a store launch

Read [store setup](../../../docs/store-setup.md), [publishing setup](../../../docs/printify-publishing.md), [environment names](../../../.env.example), and the current [environment schema](../../../src/lib/env.ts). Establish whether the request authorizes an audit, fix, preview, or production rollout. An audit remains read-only; a checklist does not authorize a real charge.

For a new-store launch, follow [the launch checklist](../../../docs/launch-checklist.md), [defaults](../store-template-readiness/references/store-defaults.md) and [owner intake](../store-owner-handoff/references/owner-intake.md). Verify dedicated resources and the configured brand/policy/shipping gates. A fresh store has no categories or garments: complete them under Products before showing or scheduling products. Verify the first authorized Printify publication arrives hidden with hosted images; after garment completion, show it and inspect the storefront and feed without per-product repository edits. Missing garment setup and the reveal gate are deliberate guards, not publication failures.

Before verifying `/feeds/google`, `/feeds/meta` and publishing health, complete every published garment under **Garment models**. New publications start hidden. Missing profiles make feeds fail with `UNSUPPORTED_BLUEPRINT`; health validates active hidden products as well and reports `MERCHANT_CATALOG_INVALID`. Each profile is store-owned data; no blueprint allowlist is supplied.

## Diagnose the environment first

Record checkout/branch/commit, target deployment URL/environment, canonical origin, provider account/shop identities, and publishing/paid fulfillment enablement. Inspect variable presence and sanitized error codes without revealing values. `pnpm setup:check --launch --env-file PATH` checks an isolated protected dotenv export without merging development settings; it still cannot prove the deployed environment or credential validity.

Development, Preview, and Production variables are independent. Credentials set only in Preview do not configure Production. A configuration error before a provider request calls for inspecting configuration, not changing catalog behavior. Restart the affected server or deploy a new version after environment updates, then verify runtime behavior.

A fresh clone has no credentials. The tracked `.worktreeinclude` copies only non-secret setup progress into new Codex worktrees; verify the snapshot and reconcile newer progress. Configure isolated environment secrets separately; progress does not imply synchronized rotations or a running Postgres/Stripe listener. Verify ports, listener destination, database isolation, and running services. Do not distribute live credentials into development worktrees.

Keep credential responsibilities separate: storefront/checkout Printify access, publishing writes, webhook signatures, webhook administration, cron, health monitor, Merchant feed authentication, and Stripe API access. A health-monitor credential cannot run the publishing worker. Use actual required scopes; do not broaden access to cure an unrelated failure.

For product images, follow [Blob image operations](../store-publishing-recovery/references/product-images.md): verify the fresh database baseline, dedicated public store, SDK authentication, and exact `NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST` used at build and runtime. A host change requires rebuilding. Existing snapshots need a separately verified bounded backfill; a new empty store has none to migrate. Working optimized images do not prove the feed uses public Blob originals, and a successful backfill does not prove Google recrawled or approved them.

Database TLS must verify the chain and hostname. This implementation relies on session locks: use a supported direct/session connection and preserve rejection of transaction pooling. Follow the maintained setup rather than disabling certificate checks.

## Verify by layer

For a focused environment repair, verify the affected behavior and relevant dependencies. Use the full set below when auditing a launch; do not expand a two-variable repair into unrelated account setup.

| Layer            | Evidence                                                                                                                                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source and CI    | Current commit/intended diff; checks from [AGENTS.md](../../../AGENTS.md), [package.json](../../../package.json), and [CI](../../../.github/workflows/check.yml). For code changes run structure, lint, typecheck, formatting, and relevant behavior tests. Full CI must pass before merge. |
| Storefront       | Desktop and narrow viewport; keyboard/focus; color/size selection; unavailable variants; bag persistence/totals, cancellation, support and actual policies. Verify behavior in a browser.                                                                                                   |
| Catalog          | Correct published membership, retail prices, stock/production eligibility, stable IDs and matching images. Provider failure must not silently become an empty catalog.                                                                                                                      |
| Checkout         | Use [Stripe setup](../store-stripe-checkout/SKILL.md) for storefront sandbox checkout and signed-event replay. Confirm simulated fulfillment and no Printify order.                                                                                                                         |
| Publishing       | Use [publishing recovery](../store-publishing-recovery/SKILL.md) for intake, durable jobs, acknowledgment, snapshots, worker, and separate monitor health.                                                                                                                                  |
| Discovery        | Production robots, sitemap, canonicals, product metadata and direct image crawlability. Use [Merchant setup](../store-google-merchant/SKILL.md) for claim, import and diagnostics.                                                                                                          |
| Analytics        | Follow [conversion measurement](../../../docs/store-setup.md#conversion-measurement). Verify the store's Vercel project, production hostname and current plan's custom-event availability for `product_viewed`, `add_to_cart`, `begin_checkout` and `purchase`.                             |
| Owner operations | Support destination, payment receipts, actual shipping/returns policy, fulfillment funding/approval setting, and ownership of failures. Do not invent commitments.                                                                                                                          |

The isolated [conversion browser tests](../../../e2e/conversion-tracking.spec.ts) intercept payments and analytics; they verify behavior without proving Vercel ingestion. Keep fixture events out of production analytics. Sandbox and simulated payments intentionally produce no `purchase` event. After an authorized deployment, verify ordinary browsing events in the matching production dashboard and confirm `purchase` on the next legitimate live order or an explicitly authorized live test. Leave that measurement pending until observed; an analytics check does not authorize a purchase. Keep analytics delivery, payment and fulfillment evidence separate.

Respect test database guards. Database suites use disposable local databases and may replace schemas. Read their setup, supply only the intended disposable database, and report skipped database checks rather than treating mocks as durability verification.

## Release the authorized result

The launch checklist requires working sandbox Checkout and the enabled services’ deployed evidence. Real purchase tests, physical samples and merchant listing approval are separate, scope-dependent checks: a purchase needs its own authorization, and an unused Google/Meta channel is not applicable. Record pending sample or chosen-channel approval for the owner’s concrete launch decision. Never mark a check verified merely because opening was approved. Run `pnpm setup:check --launch` for local configuration and required schedules; it does not verify providers or authorize activation.

Going live and testing a purchase require explicit approval; name both if requesting them together. This includes clarifying simulated versus paid tests, not treating every automated fixture check as a purchase. An instructed product batch needs no separate batch review or approval per product, but does not grant release or purchase approval. Reuse the exact approvals already granted.

Present the exact deployment/configuration change and evidence before a required final approval. Reuse explicit session authorization for the same action. Merging, production rollout, enabling paid fulfillment, and a live purchase each need authorization appropriate to the action; publishing does not enable paid fulfillment.

After deployment, verify the production hostname, deployed commit, runtime behavior, webhook destinations, scheduled work and diagnostics. Preview success cannot establish production readiness. Do not transplant historical counts or green checks into a current receipt.

A live-order check requires an authorized item, destination, and spending limit under the active tool rules. Verify payment, one correctly matched Printify order, production state, and later shipment independently. A success page does not prove manufacturing or delivery. If a purchase is outside scope, mark the check pending.

Report layers as passed, failed, pending, skipped, or unavailable, with URLs or sanitized receipts and next actions. Use [order recovery](../store-order-recovery/SKILL.md) for paid orders needing attention instead of retrying provider writes by hand.
