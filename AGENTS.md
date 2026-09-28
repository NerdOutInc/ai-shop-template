# Working on your store

We're always having fun! We use humor in all contexts because it keeps things light and engaging. Keep the humor inclusive and the instructions clear. The shirts can have jokes; configuration should be unambiguous.

## Set up a new store

This is an AI-first template. When the owner asks to set up, personalize, connect or launch a new store, read [.agents/skills/store-setup/SKILL.md](.agents/skills/store-setup/SKILL.md) and [docs/store-setup.md](docs/store-setup.md) first. The agent owns the routine work; the owner supplies facts, signs in and chooses designs.

- Discover tools available in this session. Prefer provider connectors or CLIs when useful, then browser and computer tools for dashboard work. Never claim a browser plugin or image tool is bundled by this repository.
- Ask the owner to take over for username/password entry, 2FA, CAPTCHA, passkeys and operating-system Yes/OK prompts. Prepare the exact form first, then verify the non-secret resulting state and resume.
- Offer visual exploration of the storefront, brand logo, favicon and palette. Generate only the requested/accepted exploration scope; inspect the results and retain approved source assets.
- Read ignored `.store-setup.local.json` if present. Otherwise copy `store-setup.example.json` there. Save non-secret answers, delegation, verified evidence and the next action; never credentials, private owner details or authentication links. `.worktreeinclude` copies only this file into new Codex managed worktrees; verify the snapshot and reconcile newer progress at handoff. Never add `.env*` or grant files to worktree-copy rules.
- Customize `src/lib/store-config.ts`. Keep `configured`, `policies.published` and `commerce.shippingConfirmed` false until the actual brand, reviewed policies, shipping amounts and delivery estimates are implemented. Complete those gates before sandbox Checkout. Run `pnpm setup:check`, then `pnpm setup:check --sandbox` for test payment configuration. Use `pnpm setup:check --launch` for live configuration and required worker schedules; every mode leaves remote readiness unverified.
- Keep real fulfillment and optional marketing disabled during preparation. Draft products by default. Respect explicit publication, release and purchase-test authority already given; do not ask again for the same action.
- Account creation, verified connection, deployment, catalog publication, payment capture, Printify production and customer delivery are separate outcomes. Report each honestly.

## Start with the context

- Read the relevant code, tests, documentation, and history before changing behavior. Surprising code may protect a constraint you have not discovered yet; understand that constraint before simplifying it.
- Discuss substantial architectural or user-facing behavior changes before implementation. Make small, clearly specified fixes directly. An approved plan already authorizes its implementation; do not ask for the same approval again.
- Keep changes within the authorized task. Preserve unrelated edits, staged files, installed skills, and generated artwork. Never silently replace product requirements with assumptions.
- Use relevant installed skills, reading their instructions when applicable. Do not copy entire skills into repository instructions.
- Add justified dependencies within the selected stack when needed. Ask before introducing an external service or replacing an architectural choice.
- Propose changes to these conventions before changing the instructions or their enforcement. Never weaken a check just to make a task pass.

## Organization and naming

Follow [docs/architecture.md](docs/architecture.md) for the folder map, import boundaries, examples, and exact exceptions.

- Keep routing, page composition, and global styles in `src/app/`. Put route-owned presentation in that segment's `_components/`; only that segment and its descendants may use it.
- Keep feature-owned behavior together in `src/features/<feature>/`. Start flat and create subfolders only for responsibilities that actually need them.
- Use `src/components/`, `src/hooks/`, and `src/lib/` for demonstrated shared responsibilities. Keep official shadcn Base UI primitives in `src/components/ui/`. Do not create empty future-feature scaffolding or generic dumping grounds.
- Use kebab-case source filenames; PascalCase components and types; camelCase functions and variables; and `use`-prefixed React hooks. Preserve Next.js reserved filenames and routing syntax.
- Colocate unit/component tests and stories with their implementation as `name.test.ts(x)` and `name.stories.tsx`. Keep shared test support in `test/` and browser journeys in `e2e/`.
- Export one runtime unit per ordinary source file. Associated types and private helpers may stay beside it; type-only files may export related types. Use named, direct exports. Do not create application barrels or import-and-re-export collections.
- Apply only the documented, narrowly scoped exceptions for framework conventions, tool configuration, stories, and explicitly identified official shadcn files. Neighboring application files remain subject to the ordinary rules.
- Use relative imports within the same feature or local unit and `@/` imports across areas. Follow the dependency directions in the architecture guide for both runtime and type imports.
- Avoid runtime dependency cycles; type-only cycles are allowed. Production code must never depend on tests, stories, or browser-test support. Dynamic imports in application code must use string literals so tooling can inspect them.
- Protect server-only modules with `import "server-only"`. A `.server` filename is a hint, not a security boundary. Prefer Server Components and keep client boundaries limited to necessary interaction.
- Put deliberately public website assets in `public/`. Keep operational print sources, final uploads and revision evidence in private Blob storage and the database; use ignored local staging for work in progress. `assets/print/README.md` documents that boundary. Keep reusable Python artwork tools in `scripts/artwork/`. For shirt artwork or Printify products, read the [asset index](assets/print/README.md) and [Printify workflow](docs/printify-workflow.md) first; apply and inspect placement yourself.
- Own the complete artwork workflow: use the app's draft/reconciliation path with the exact private artwork revision and upload evidence, then verify the final standalone artwork slide after authorized publication. Check its raw and optimized images and selected garment-color background in the real gallery; use the admin preview for hidden products. A Printify success message alone is not completion. Draft-only requests stop before publication with provenance ready. Follow [artwork-preview recovery](docs/artwork-previews.md#repair-missing-previews-on-saved-publications) for gaps; do not make per-product repository edits, static mappings, or raw SQL the routine publishing path.

## Comments and rationale

Let clear code tell the story. Use short comments to explain difficult logic, hidden constraints, and why a decision was made—especially when an apparently simpler alternative would be wrong. Do not narrate obvious statements or write a novel above a function.

Explore the problem before assuming the previous author missed the obvious. Put larger architectural rationale in documentation, link it where useful, and update affected comments when behavior changes.

## Validate and deliver

- Treat `package.json`, the lockfile, and tool configuration as the source of truth for versions and commands. Use the pinned package manager.
- For code changes, run `pnpm check:structure`, `pnpm lint`, and `pnpm typecheck`, plus relevant behavior tests. Check formatting with `pnpm format:check`. Run `pnpm test:architecture` when changing enforcement.
- Verify UI changes in a browser, including a narrow viewport, keyboard access, and visible focus. Exercise changed stories interactively. Test behavior and meaningful failure cases rather than mirroring implementation details.
- Require the full CI suite before merge; `pnpm check` runs baseline checks and `pnpm check:all` runs the full local suite. Report passed, failed, pending, skipped, and unavailable verification accurately. Do not call an untested interaction verified because a build passed.
- Default to a `codex/` branch and draft pull request. Commit and push only intended changes. Merging and production release require an explicit request; an authorized preview deployment does not authorize production promotion.
- Report the concrete change, verification results, and unresolved limitations. Keep the handoff concise and include usable PR and preview links when applicable.

## Code review

- Check behavior, import ownership, server/client boundaries, accessibility, and relevant tests against the request and surrounding code.
- Explain actionable findings with a concrete trigger and consequence. Investigate intent and history before labeling unusual code a defect.
- Keep review-only requests read-only. Do not modify code, approve, merge, or resolve review threads unless that action is authorized.
