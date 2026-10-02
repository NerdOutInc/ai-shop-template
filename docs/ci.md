# Continuous integration

`Check` runs focused PR verification on every pull request, including drafts, and for merge queues. Pushes to `main` run full verification. It has no changed-path filter. Lint and commerce browsers start immediately; changed-test selection feeds Foundation and any selected presentation jobs, which then run in parallel, so a successful run does not add their elapsed times together. Browser checks should not need a calendar invitation.

| PR check                    | Coverage                                                                                                                                                                                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint and formatting         | ESLint, pinned Ruff and Prettier                                                                                                                                                                                                                    |
| Foundation checks           | Types, structure, immutable migration history, critical payment/fulfillment/consent/access regressions with real local Postgres, fresh-template permissions, architecture, branding, dependency maintenance, skills, artwork, setup and portability |
| Commerce browser checks     | One isolated configured production build; desktop Chromium and phone WebKit customer journeys against disposable Postgres and offline providers                                                                                                     |
| Changed presentation checks | Selected changed stories, public/publishing specs and both admin signup configurations; each applicable job runs on its own runner                                                                                                                  |
| Required checks             | Accepts only successful results from the selection, lint, Foundation, commerce and any selected presentation jobs; failed, cancelled, skipped or missing required jobs block the gate                                                               |

This ports the focused-commerce model from source PR #151 and its later reviewed changes, with template-specific checks retained. Unlike the source's draft-only lint path, draft PRs here run the same gate as ready PRs. The exact test files and disposable database names are listed in [commerce-test-scope.json](../scripts/ci/commerce-test-scope.json). The isolated [commerce configuration](../vitest.commerce.config.ts) leaves the default Vitest config with one owner per unit file. PR selection adds changed unit tests and tests/stories colocated with changed implementations. Changed stories and browser specs outside commerce run in the reusable integration jobs, and their failures block Required checks. `pnpm test:commerce` rejects a missing test file or an absent, remote, incorrectly named or query-bearing database URL before running any tests, even locally. Additional selected database tests require their exact named disposable database too. The exhaustive `unit` project keeps its existing CI database requirements.

The full suite runs on every push to `main`, weekly (Sunday 08:17 UTC) or by selecting **full** when manually running **Check**. A manual run defaults to **commerce**. [Full verification](../.github/workflows/full.yml) preserves all unit/database tests, the merchant build, Storybook interactions/build, all public and publishing browsers, and both admin signup configurations with local Supabase Auth. It includes the focused commerce journeys too. **Required checks** accepts only a successful full workflow on these runs. Full verification on the exact release head is required before production release and for Next dependency upgrades under the [metadata maintenance contract](dependency-maintenance.md); it is no longer required on every PR. If merging triggers a Vercel production deployment, run manual full verification on the exact PR head before that merge. Full CI on the subsequent main push catches regressions but cannot pause an external auto-deploy. Workflow code does not configure Vercel promotion rules.

Weekly scheduling starts after this workflow reaches the default branch.

`Full verification` and `Integration checks` can also be dispatched directly for diagnosis; their workflow results do not substitute for the PR's **Required checks** status. Full integration starts after full Foundation passes, and its jobs run in parallel. The PR workflow uses reusable workflows at the commit being checked. Separate concurrency groups prevent full/manual/scheduled work from cancelling a PR run.

The goal is a short PR critical path, rather than the former sequence of full Foundation followed by several fixture builds. Changed presentation tests can extend a PR beyond the routine commerce timing; they are never silently omitted to meet a time target. Actual time depends on runner availability, downloads and caches; report the current hosted run's elapsed time rather than treating a timeout or another repository's timing as a guarantee.

## Required merge gate

In the repository's branch protection or ruleset, require the **Required checks** status from GitHub Actions for `main`. A workflow file schedules checks; it cannot enforce repository settings by itself. A repository generated from this template must configure that rule separately. Confirm that the rule applies to the intended branches and the latest PR head before merging. Do not replace this aggregate with the foundation job alone.

Require branches to be up to date with their target (`required_status_checks.strict=true`) or use a merge queue. Migration ordering is only advisory against the last tested base without one of these controls: another PR can merge a later migration after checks pass. Generated stores inherit workflows, not repository settings. At this review the canonical repository requires the aggregate but has `strict=false`; until settings are separately approved, update each PR/stack against the latest target, rerun the PR checks and confirm the target has not advanced immediately before any authorized merge. If it advances, update and rerun again.

The aggregate uses `always()` so failed or skipped dependencies still produce a result. For PR/merge-queue runs it accepts only `success` for selection, lint, Foundation, commerce browsers and any selected presentation suites. For main pushes, weekly or manual full runs it accepts only `success` for the reusable full workflow. The separate suite names show where to investigate. The `merge_group` event supplies the same gate if the repository later uses a merge queue.

## Isolation and diagnostics

PR jobs use `pull_request`, read-only repository permissions, and checkout with persisted Git credentials disabled. They receive no repository secrets, deployment environment, or inherited secrets. Do not change this to `pull_request_target` to run PR code or add production commerce credentials to make an integration test pass. Fork PRs may need GitHub's normal workflow approval before jobs run.

Database URLs name disposable databases created inside each hosted job. Provider requests use the existing offline fixtures and synthetic credentials. Admin Auth keys are generated by the local Supabase instance and remain in its ignored status file; that file is not an artifact. Passing these checks verifies the test environments, not a live shop's credentials, deployment, payment capture, or fulfillment.

Local validation, CI, and the publishing monitor use the exact Node version in `.node-version`; `package.json`'s `engines` describes the broader supported range, not a choice of validation versions. pnpm uses `packageManager`, and validation jobs install with the frozen lockfile. The pnpm store and Python package downloads are cached. Browser binaries are installed from the locked Playwright dependency. Ubuntu browser jobs remove the unrelated Chrome apt feed and slow Azure mirror while retaining the runner's remaining HTTPS package mirrors; browser downloads and application builds are not shared between jobs, preventing stale fixture configuration from crossing suites.

On failure, open the failing step and its suite-specific artifact: `storybook-diagnostics`, `storefront-browser-diagnostics`, `publishing-browser-diagnostics`, `commerce-browser-diagnostics`, or `admin-browser-diagnostics-signup-false`/`admin-browser-diagnostics-signup-true`. Browser artifacts include the HTML report, retained traces, and failure screenshots. Storybook's Vitest project explicitly enables failure screenshots under `test-results/storybook/`, which the job uploads along with available Storybook logs. Keeping generated files outside `src/` avoids source-structure errors after a local failure. Local screenshots and Vitest attachments are ignored by Git. Artifacts expire after seven days; a failure before a browser starts may have logs only. Supabase cleanup runs after both success and failure.

For local validation, use `pnpm check` for the foundation, including its disposable PostgreSQL databases, and `pnpm check:all` to add browser and local Supabase Auth coverage. Install the prerequisites below for the command you run. Never substitute a skipped database test for a passing integration check. See [the architecture guide](architecture.md#enforcement-and-verification) and [store setup](store-setup.md#verify-before-accepting-real-orders).

## Local test prerequisites

Run commands from the repository root after the frozen pnpm install in the README. Complete `pnpm check` validation requires Node from `.node-version`, the pnpm version in `package.json`, Python 3.12 with the pinned Ruff and Pillow versions in `scripts/skills/requirements.txt`, and the disposable PostgreSQL databases below. The provider-default privilege regression additionally needs Docker when that test is present. Keep the virtual environment active while running pnpm checks, since those scripts invoke `python3`:

```sh
python3.12 -m venv .tmp/skills-venv
. .tmp/skills-venv/bin/activate
python3 -m pip install --requirement scripts/skills/requirements.txt
```

The virtual environment stays inside ignored `.tmp/`. `pnpm lint` and `pnpm format:check` use Ruff; `pnpm test:skills` uses Pillow. Installing JavaScript packages alone does not install these tools.

- **PostgreSQL 17 for Foundation:** use a disposable local instance. The full foundation job in [full.yml](../.github/workflows/full.yml) is the source of truth for the `*_TEST_DATABASE_URL` variables, exact database names, and creation command. Create each named database and export its URL before running `pnpm check`. Test setup resets schemas, so never use a live or shared store database.
- **PostgreSQL client for Foundation:** put `psql` on `PATH` for the signup-removal SQL regression, or set `PSQL_BIN` to a local executable or wrapper. Verify `psql --version` (or the configured executable) before running `pnpm check`. The Foundation workflow verifies the client and installs Ubuntu's `postgresql-client` package only when it is missing.
- **Docker Engine for provider-default privileges:** if your checkout includes `scripts/database/template-privileges.test.mjs`, that regression starts its own disposable Supabase Postgres container. Docker must be running and reachable by the current user. CI sets `SUPABASE_PRIVILEGES_TEST=true` on its database step; enable it locally before either `pnpm check` or `pnpm check:all`:

```sh
export SUPABASE_PRIVILEGES_TEST=true
```

Setting the flag does not provide privilege-test evidence in checkouts that do not contain that test. Do not reset or stop another checkout's containers to free ports.

The provider-default privilege test uses Supabase Postgres `17.6.1.167`. It reuses a cached copy or downloads that same version from Supabase's public ECR, GHCR or Docker Hub registry, in that order. Registry throttling can fall back to another official mirror; inability to obtain the image still fails the suite. The test never substitutes plain Postgres or skips permission assertions after a download failure.

For `pnpm check:all`, install the browsers matching the locked Playwright version:

```sh
pnpm exec playwright install chromium webkit
```

On Linux, use `pnpm exec playwright install --with-deps chromium webkit` to install the browser system libraries too. In addition to the Foundation prerequisites, the full suite needs:

- **Two additional browser databases:** the storefront job in [integration.yml](../.github/workflows/integration.yml) defines `CATALOG_E2E_DATABASE_URL` and `PUBLISHING_E2E_DATABASE_URL`. Create those disposable local databases and export their URLs too.
- **Docker Engine for local Supabase Auth:** keep the container runtime running for the admin browser suite.
- **Supabase CLI 2.114.0 on `PATH`:** use the [official CLI installation guide](https://supabase.com/docs/guides/local-development/cli/getting-started) to install the version pinned in [integration.yml](../.github/workflows/integration.yml), and verify `supabase --version`. `pnpm test:admin:prepare` starts local Auth, Mailpit, and its database and applies the app migrations; no Supabase cloud login or project link is needed.
- **Available local ports:** public browser fixtures default to 3100 and 3200; override them with `PLAYWRIGHT_PORT` and `PLAYWRIGHT_FIXTURE_PORT`. Publishing defaults to 3300 and 3301; override them with `PUBLISHING_E2E_PORT` and `PUBLISHING_E2E_PROVIDER_PORT`. Commerce defaults to 34100 and 34200; override them with `COMMERCE_E2E_PORT` and `COMMERCE_PROVIDER_PORT`. Admin uses 3300 plus the 5883x ports in [supabase-config.toml](../e2e/admin/supabase-config.toml). Publishing and admin need to run sequentially only when their selected ports collide. The admin fixture still has a fixed project ID; run one local admin suite at a time and do not reuse another checkout's running fixture. See the [test-store guide](test-store.md) for fixture and port configuration.

`pnpm check:all` prepares and rebuilds the fixtures before the browser suites. For a focused publishing run, use the [publishing commands](printify-publishing.md#validate-the-complete-connection), including `pnpm test:e2e:prepare` each time; a root `pnpm build` does not refresh `.tmp/storefront-e2e`. After local admin testing, stop only the instance this checkout started:

```sh
supabase stop --workdir .tmp/admin-e2e --no-backup
```

Local admin preparation defaults to public signup disabled. To exercise the other CI configuration, stop this checkout's fixture first, then prepare and rebuild it:

```sh
ADMIN_E2E_PUBLIC_SIGNUP=true pnpm test:admin:prepare
pnpm test:admin:build
pnpm test:e2e:admin
supabase stop --workdir .tmp/admin-e2e --no-backup
```

A skipped database suite does not count as validation. CI provisions all required environments, so use the complete **Required checks** result when local prerequisites are unavailable.

## Migration history gate

Foundation checks run `pnpm check:migration-history` against the event's explicit prior commit, with full Git history available. Existing SQL filenames, bytes and previously recorded forward-port mappings are immutable; new migrations must follow the receiving history and have distinct timestamps. Local `pnpm check` includes the same guard, defaulting to a fetched `origin/main`. A missing base deliberately fails closed, including an unpushed repository without a remote. Set `MIGRATION_BASE_REF=FULL_BASE_SHA pnpm check` for a reviewed local snapshot, or pass `--base` to the standalone migration-history command; do not invent an empty baseline to bypass protection. See [migration identity and receipts](store-update-contract.md#migration-identity-and-forward-port-receipts) for aliases used by canonical docs and skills. This gate protects repository history and does not establish the deployed schema or upgrade safety for populated data.

## Customer commerce journeys

`pnpm test:commerce:build` creates an isolated configured fixture in `.tmp/commerce-storefront-e2e` using the template test brand and local origin. It never patches merchant config in place. Run `pnpm test:e2e:commerce` with `CATALOG_E2E_DATABASE_URL` pointing to disposable local `store_catalog_e2e`. This resets the catalog fixture, so run it after the public storefront suite rather than concurrently.

Desktop Chromium and phone WebKit cover every public page, catalog filters and options, keyboard image navigation, persisted cart edits, accessible checkout, inbox confirmation and unsubscribe, forged/unpaid payment rejection, changed prices and webhook replay after a lost fulfillment response. Synthetic Stripe, Printify and Resend servers bind to loopback and block external requests. These journeys prove application behavior against fixtures; they do not prove payment capture, real printing or inbox delivery. These journeys form the PR browser gate. The exhaustive Foundation, Storybook, storefront, publishing and admin suites remain in full verification.

The PR commerce job builds only its configured fixture and has a 15-minute timeout. The full storefront job retains its 45-minute timeout for three fixture builds and all public/publishing/commerce journeys. Read the selected suite and **Required checks** together; a skipped required step provides no hosted coverage.
