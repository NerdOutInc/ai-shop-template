---
name: store-template-readiness
description: Audit template maintenance, portability and brand isolation. Use for template hygiene or an isolated second-brand trial; use store-setup for onboarding and store-launch-verification for a store launch.
---

# Check template readiness

Read [the setup workflow](../store-setup/SKILL.md), [store defaults](references/store-defaults.md), [configuration map](references/extraction-map.md), and [architecture](../../../docs/architecture.md). Inspect the actual checkout and current configuration before making claims. The template should come with instructions, not somebody else's digital sock drawer.

A fresh instance has neutral public branding, no inherited provider identity, no real catalog/artwork/customer/admin data and no active fulfillment, marketing or worker connection. Run `pnpm check:template` for known source identity/asset fingerprints, private setup state, recognizable credentials and machine-local paths; read [template hygiene](../../../docs/template-hygiene.md) for exact exceptions and limits. Run `pnpm setup:check` for configuration status. Separately search the staged/tracked tree as well as runtime code, docs, fixtures, CI, migration policies, binary assets, hidden files and Git history for unintended source-store material. Scans are evidence, not a promise that arbitrary future changes cannot leak data.

Use `src/lib/store-config.ts` for public identity, theme and supported business configuration; `.env.local`/deployment secrets for credentials; the database for store-owned operational state. Keep private owner details out of committed setup files. Reset only a newly created instance: never erase an operating store's pending-order identities, payment deduplication, artwork sources or provider receipts as a rebranding shortcut.

For a second-brand trial, configure a distinct sample brand locally with no live providers, verify metadata, header, footer, home, support, logo and favicon, public URLs, storage namespaces and checkout identity consumers, then restore the exact prior configuration and assets. Use an isolated worktree for the trial; never reset a downstream owner’s brand to template defaults. Check USD/US support limits explicitly; text substitutions do not implement new currencies or shipping models.

Confirm the new database has no preclaimed admin, products, categories, garments, grants, favorites, design reservations or imported art. Provision the restricted runtime role and test actual privileges. Follow the setup skill to create the first reviewed product; do not require a source-store base product or per-product repository mapping.

Acceptance includes working owner/browser handoffs, non-secret resumable state, explicit draft/publication boundaries, complete garment setup, provenance-bound artwork, and separate configuration/local/sandbox/live evidence. A provider dashboard success message does not establish every downstream step. Report concrete findings, checks and gaps. If asked only for an audit, keep implementation read-only; if remediation is authorized, finish it within scope.
