# Set up your store with an agent

The normal workflow is **Use this template → clone → ask an agent to set up the store**. The agent reads [the setup skill](../.agents/skills/store-setup/SKILL.md), asks for missing choices, prepares accounts and configuration, and verifies each result. The owner signs in, supplies business facts and chooses designs. Nobody needs to become a part-time webhook archaeologist.

## Resume and tool discovery

Read ignored `.store-setup.local.json` if present; otherwise copy `store-setup.example.json` there. Keep public brand choices, delegated rules, safe resource identifiers, status, verification evidence and the next action there. Do not store credentials, account usernames, private owner contact information, login links, email codes or customer data. Local `.env.local`, deployment secrets and private grant files are different storage destinations. Commit permanent public choices in `src/lib/store-config-values.ts` and approved public brand assets.

The repository's `.worktreeinclude` lists **only `.store-setup.local.json`** so supported worktree tools can copy existing non-secret progress. Both Codex managed worktrees and Claude Code worktrees support this file. This is a snapshot, not synchronization; it does not copy environment files, provider keys or agent grants. Verify the copied file and its timestamp before resuming, update the timestamp with progress, and reconcile the latest verified answers/evidence at handoff without overwriting another checkout's newer work. If the copy is absent, recover the non-secret progress from the originating checkout or initialize it explicitly. [Codex's worktree documentation](https://developers.openai.com/codex/app/worktrees/), checked **2026-09-27**, describes this local managed-worktree behavior, including no overwrite of existing files and no copy of source symlinks. [Claude Code also honors `.worktreeinclude`](https://code.claude.com/docs/en/worktrees). Run `pnpm setup:check` before resuming: it warns when another worktree listed by Git has a newer `resume.updatedAt` or an unreadable progress copy. Inspect those copies, verify facts and reconcile deliberately; the checker never merges or copies them. Manual/remote worktrees still need a deliberate non-secret handoff. Saved progress is evidence only under [authority and saved progress](../.agents/skills/store-setup/SKILL.md#authority-and-saved-progress).

Discover the host's available browser, computer, connector, CLI and image tools. Repository skills describe workflows; they do not install or grant access to Browser, Computer, image generation or provider accounts. Prefer purpose-built APIs or CLIs when they cover the task; otherwise operate the actual dashboard with browser/computer tools. Read the current provider documentation before relying on changing UI labels, plans, scopes or pricing.

Prepare forms first, then let the owner enter usernames/passwords, email codes, 2FA, CAPTCHA, passkeys and OS **Yes/OK** permissions directly. Ask for a non-secret completion signal and read back the resulting state. Never ask for secrets in chat, copy cookies or bypass a security prompt. Missing tools require a precise handoff, not a claim that setup was verified.

## Intake and design

Ask a short first round about brand name, audience, existing domain/assets/accounts, visual direction, products, selling region and budget. Offer generated alternatives for storefront concepts, logo, favicon and color palettes. Ask which explorations the owner wants and their count, show the options, and implement the selected direction while preserving original/approved assets.

Use the [branding guide](branding.md) for the public asset map, logo choices, font stacks and favicon/PWA generation. Preserve the approved mark, generate the required sizes with `pnpm icons:generate --source public/images/store-mark.svg --background '#25364d'` after choosing the store's actual background color, and run `pnpm test:branding`. The generator also supports `--output-root .tmp/brand-icons-preview` for inspection before replacing public icons.

Resolve prices or a margin rule, garment colors/sizes/provider, shipping charges, delivery promises, support contact, policies, IANA time zone, weekly feature day/time and delegated product choices before their dependent step. Follow [owner intake](../.agents/skills/store-owner-handoff/references/owner-intake.md). Reuse existing answers; missing information is not permission to invent a merchant policy.

The current commerce implementation supports **USD, standard shipping to the 50 US states plus DC**. The built-in per-design color picker, design-page draft button and `drafts.propose` support **Next Level 6210, blueprint 1317, print provider 99** only. Choose that combination for the complete built-in workflow. Another provider or garment needs an explicit verified front-art recipe and its own supported variants; its colors do not become supported by the per-design picker. Additional garments also need complete merchant profiles. Territory/military/international destinations, currency conversion, coupon offers and arbitrary shipping models need coordinated implementation and tests.

Record the owner's confirmed initial blueprint/provider in `decisions.printifyBlueprintId` and `decisions.printifyPrintProviderId` in `.store-setup.local.json`; the automatic setup check supports 1317/99. A different explicit recipe remains a separate assessed workflow, not a promise that the built-in setup gates support it. Set `decisions.commerceIdentity` to the immutable store identity chosen before the first Checkout. Set `commerce.identity` in store configuration and keep it stable and distinct from cosmetic branding IDs: pending payment records depend on it. Configure `CHECKOUT_RATE_LIMIT_SECRET` before opening new Checkout sessions, using one independent random 32–256 character server secret shared by this store's replicas; never record its value in setup state. A brand rename must not rotate either identity or the secret as an incidental copy change.

Follow [Checkout resilience](checkout-resilience.md) for database identity verification, admission limits, trusted deployment headers, edge/WAF protection and provider spending checks.

Customize `src/lib/store-config-values.ts`, public identity assets, theme and home copy. Set `timeZone` to the owner’s IANA zone. Optional `features.designOfTheWeek`, `features.dropSignup` and `features.about` start false; enable only the owner’s selected features. Confirm support and list-removal operations before enabling drop signup. Set `weeklyFeature` when the weekly feature is selected; the neutral default is Monday at 09:00 UTC. `configured`, `policies.published` and `commerce.shippingConfirmed` start false. Set them true only after implementing the actual brand, owner-reviewed policy text, shipping amounts and delivery estimates. Both sandbox and live Checkout are blocked until these gates are complete. A schema passing validation cannot establish that a shipping promise is accurate or a policy is appropriate.

Use [storefront feature controls](storefront-features.md), [shipping and policy setup](storefront-policies.md), and [drop signup operations](drop-signup.md) for the implementation and launch checklist. Signup requires an activated production confirmation sender and worker before the public form is shown. Its store-wide rolling-hour ceiling defaults to 20 (`SIGNUP_CONFIRMATIONS_HOURLY_LIMIT`, range 1–1000). Weekly [drop emails](drop-emails.md) are a separate default-off marketing switch. Support lookup/removal and guarded erasure are available in Products → Drop emails; never-confirmed pending signups expire automatically. Follow the runbooks for external-list suppression and production verification.

## Dependency order

| Phase                 | Agent work                                                                         | Owner participation                                    | Evidence before proceeding                                        |
| --------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------- |
| Local baseline        | Install pinned tools; run setup check; inspect neutral shell                       | Brand and business answers                             | Clean local configuration report and visible shell                |
| Repository/deployment | Verify new repository; prepare Vercel project and domain configuration             | Sign-in, uncovered costs/terms/DNS authorization       | Exact repository, deployment project and intended origin          |
| Database/Auth         | Apply fresh baseline to new Supabase project; provision restricted runtime access  | Sign-in and secure credential entry                    | Migration history, runtime-role grants, verified TLS              |
| Storage/email/admin   | Separate private/public Blob stores; SMTP; first-owner enrollment                  | Email verification and device passkey prompts          | Actual email receipt, admin access and protected download         |
| Printify              | Dedicated API shop, limited-permission tokens, draft/product profile and workers   | Sign-in, billing/account checks, publication choice    | Correct shop, signed event, snapshot, images and fresh stock      |
| Storefront/policies   | Complete garment/category records, brand, policies, shipping and a visible product | Approved public choices                                | Checkout setup gates satisfied; product and policy consistency    |
| Stripe sandbox        | Restricted test key, signed Checkout webhook, receipts and store test              | Secure key entry and test form as required             | Simulated paid order and zero Printify orders                     |
| Launch                | Prepare verified configuration and exact activation actions                        | Uncovered production, cost and live-purchase decisions | Deployed revision, webhook/worker evidence and actual live result |

Each store has its own repository, domain, deployment, Supabase project, Printify shop, Stripe account and separate private/public storage. The same person can own these resources. Printify tokens cover the merchant account's shops, however: separate shops and tokens do not create an account-level security or rate-limit boundary. Use a separate Printify account per brand; a shared account is an explicit owner-accepted exception documented with its account-wide token and quota exposure (see [operations and costs](store-operations-costs.md)). Do not borrow another store's shop, credentials, data or callback subscription. Reuse verified resources dedicated to this store; do not create duplicates after a timeout.

## Personalize the generated repository

Verify `git remote -v` points to the owner's newly generated repository. Capture its origin while the working tree is still clean, before changing any tracked files.

Before the first customization commit, capture the generated repository's origin with `node scripts/template/capture-store-baseline.mjs --template-dir <local-template-checkout> --template-ref <verified-full-SHA>`. Fetch and verify the intended canonical template release in that separate checkout first. The helper compares the generated root commit tree against template history and writes `docs/store-update-ledger.json` only for a unique match; it refuses missing/ambiguous evidence and never guesses. If several commits share the same tree, use `--template-commit <full-SHA>` only with independent creation evidence. Review and commit the ledger before branding edits, then follow the [update contract](store-update-contract.md). A customized root or missing history needs the contract's reviewed recovery path.

Then rename `package.json`’s `name` to the new project’s package-safe name. Replace this template’s README title, starter links and store-facing instructions with the new store’s repository/admin/setup links; preserve the [template provenance](template-origin.md) and license attribution.

Review `.github/workflows/` against the new remote and default branch. The baseline Check workflow targets `main`; adjust that branch filter if the owner chose another name. The optional monitor derives the repository from GitHub's runtime context and runs on its default branch, but still needs this repository’s own health URL, secret, enablement and optional incident assignee. Verify generated issue/recovery links and intended repository permissions before enabling it. Do not copy another repository’s secrets or incident settings.

Prepare the [repository security and required merge gate](launch-checklist.md#repository-security-and-merge-gate) for the owner: confirm Dependabot alerts, automatic security updates, secret scanning and push protection, recording any unavailable/off setting. Once the workflow is present and has run on the generated repository, require **Required checks** on its default branch using an applicable branch protection rule or ruleset. Verify the exact required context and bypass behavior; **Foundation checks** alone omits browser/admin/Storybook outcomes. Private-repository branch protection/rulesets require GitHub Pro, Team or Enterprise. Follow [repository security settings](dependency-maintenance.md#repository-security-settings) and the [CI merge gate](ci.md#required-merge-gate); paid plan changes and account prompts stay within owner authority.

Dependabot alerts and security updates make vulnerabilities and blocked Next security fixes visible when the supported patch range needs review; template files do not establish the generated repository's settings.

## Local baseline and deployment

Use the Node.js version in `.node-version` for development and validation, and the pnpm version pinned in `package.json`. The package `engines` field is the supported range, not a replacement for the pinned validation version:

```sh
corepack enable
pnpm install --frozen-lockfile
if [ ! -f .env.local ]; then
  cp .env.example .env.local
fi
pnpm setup:check
pnpm dev
```

The no-secret shell is available at `http://localhost:3000`; provider-backed catalog/checkout stay unavailable until configured. The template does not include demo orders, designs or a public product seed.

### Local verification prerequisites

`pnpm dev` needs the pinned JavaScript dependencies. Repository validation has additional prerequisites; a missing executable is not a passing check. Follow [the CI guide's local prerequisites](ci.md#local-test-prerequisites), `package.json`, `scripts/skills/requirements.txt`, `.github/workflows/check.yml` and `.github/workflows/integration.yml` for current versions and commands. Python 3.12 with the pinned Ruff and Pillow packages is needed for skill lint/format and artwork tests:

```sh
python3.12 -m venv .tmp/skills-venv
. .tmp/skills-venv/bin/activate
python3 -m pip install --requirement scripts/skills/requirements.txt
```

For `pnpm check`, provide disposable local Postgres databases, the PostgreSQL client, a running Docker engine for the Supabase privilege regression, and the exact suite-specific environment variables from the Foundation workflow; suites reset their schemas and must not share a database. `pnpm check:all` additionally needs the integration workflow's browser databases, Supabase CLI on `PATH`, and Playwright's Chromium/WebKit browsers (`pnpm exec playwright install chromium webkit`; Linux may also need `--with-deps`). The admin preparation command starts its dedicated local Supabase fixture. Coordinate ports, container/project names and database names before running on a shared machine; never stop/reset another chat's service to claim a port. Follow [test-store isolation](test-store.md) for fixture behavior and per-suite port overrides; check fixture guards in the current scripts before changing their names. Local full-suite success and current GitHub CI are separate evidence.

Connect only the new repository to the intended Vercel project. The default `vercel.json` has no worker schedules. Review `scripts/vercel-crons.example.json` and merge the publishing, stock and popularity entries explicitly before enabling the integrations; order alerts and drop emails are optional. A `CRON_SECRET` and deployed routes alone do not configure a scheduler. Preview deployments require separate data/storage and direct worker test calls because production cron schedules do not run on previews.

### Supported hosting and scheduled workers

The supported Vercel deployment for this commercial store is **Pro or Enterprise**. Official requirements checked **2026-09-27**: [cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing) allow 100 jobs per project on each plan, but Hobby runs each job at most daily with hour-level precision; Pro/Enterprise support minute-level schedules. [Hobby is restricted to personal, noncommercial use](https://vercel.com/docs/plans/hobby). Function usage is billable under the selected plan; verify current costs and existing owner authorization before purchasing anything.

Review [store operations and costs](store-operations-costs.md) with the owner for recurring provider charges, required workers and conditional integrations before choosing or activating a plan.

Configure publishing recovery every minute (`* * * * *`), stock every 30 minutes (`*/30 * * * *`), and popularity every six hours (`0 */6 * * *`). Vercel schedules use UTC; the app's weekly feature uses its separately configured IANA time zone. A daily stock job cannot satisfy the app's two-hour freshness cutoff: missing/expired observations close browsing availability and cause merchant feeds to return 503. Initialize both catalog observations and then verify recurring successful runs, following [background refresh](catalog-background-refresh.md). Keep configured schedules, observed execution and completed work as separate evidence.

Other hosts or external schedulers need an explicit implementation/verification scope for this Next.js Node runtime, private/public Blob access, database TLS, authenticated worker calls and equivalent cadence. Changing the hosting label does not establish support.

Set `NEXT_PUBLIC_SITE_URL` to the permanent HTTPS origin for production. Public variables, canonical identity and the public Blob hostname are embedded at build time, so rebuild after changing them. Verify domain/DNS and the final deployment independently. Enabling GitHub's Template repository setting is only needed on the template's repository, not every generated store.

For authorized production-configuration inspection, verify the linked Vercel project/team first and export to a separate ignored file instead of overwriting local development settings:

```sh
umask 077
mkdir -p .tmp
vercel env pull .tmp/setup-production.env --environment=production
chmod 600 .tmp/setup-production.env
```

The [Vercel environment CLI](https://vercel.com/docs/cli/env), checked **2026-09-27**, supports an explicit output file and environment. Inspect this file only through the offline setup check; never source it into tests, print it, commit it or add it to `.worktreeinclude`. Vercel's [Secret values are write-only after saving](https://vercel.com/docs/environment-variables/sensitive-environment-variables), so an export does not establish that every deployed secret is readable or valid. In `--env-file` mode, keys explicitly exported as empty or `[SENSITIVE]` are reported as `UNREADABLE`; they are neither configured nor invalid. Missing required keys and invalid readable values still fail. An exit 0 with unreadable fields means only that readable checks passed, and the report retains an incomplete-evidence warning. Record unavailable fields as unverified and use an authorized secure verification path; never weaken secret visibility to make an export complete. Compare the intended project/environment and deployed revision separately, then remove the temporary secret file when no longer needed.

## Database and TLS

Create or verify the store's own Supabase project. Apply `supabase/migrations/20260928000354_storefront_baseline.sql` to the new empty database through the **Supabase CLI migration workflow**, using an authorized migration-owner connection. This is the template's fresh-schema baseline; also apply any later migrations present in this checkout. Do not copy a prior store's database, Auth users, grants or seed products.

From the repository root, inspect the installed CLI's `--help`, let the owner complete login/credential prompts privately, and replace only the non-secret project reference below:

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase migration list --linked
supabase db push --linked --dry-run
supabase db push --linked
supabase migration list --linked
```

Before the push, verify the linked project is this store and review the dry-run migration list. Afterward, require every expected migration version in both local and remote history. Save only the project reference, applied versions and check result in setup state. [Supabase's `db push` documentation](https://supabase.com/docs/reference/cli/supabase-db-push), checked **2026-09-27**, explains that successful pushes record versions in `supabase_migrations.schema_migrations` and skip them on subsequent pushes. Bare `psql -f` or pasting the baseline into the SQL editor bypasses that history and is not the setup path. If schema and history disagree on a resumed setup, investigate before rerunning SQL or using `migration repair`; do not mark an unverified migration applied. The private `psql` password step below provisions the login, not the schema.

### Future schema changes

Treat every applied migration, including the fresh baseline, as immutable. Create each later change with `supabase migration new <descriptive_name>`, inspect the generated file and apply all ordered migrations with `db push`. Do not edit the applied baseline, copy another store's old migrations, or introduce compatibility paths for its data.

Every new table, sequence, view or function must include its access contract in the same migration. Grant only required schema/object privileges to **`store_app_runtime`**, never replace the runtime login with `postgres` or `service_role`. Enable RLS on application tables and define explicit policies for each allowed verb: `SELECT`/`DELETE` use `USING`, `INSERT` uses `WITH CHECK`, and `UPDATE` needs both plus any required `SELECT` access. Preserve narrower owner/admin policies for intentionally browser-accessible library data; do not copy a permissive runtime policy onto a browser role.

For server-only objects, explicitly revoke browser access from `anon`, `authenticated` and inherited `PUBLIC` grants, including function execution and sequence access where relevant. Default privileges and grants on existing objects are separate: neither substitutes for the other. The current baseline already names the restricted role and per-verb policies; follow the required operation's scope rather than copying `GRANT ALL` or giving every table every verb.

Test both a fresh database and an upgrade from the previous schema in disposable databases. Reconnect as the actual runtime login and verify required operations succeed and forbidden ones fail. Inspect effective per-verb privileges with `has_table_privilege` (and corresponding schema/sequence/function checks), inspect `pg_policies`, and prove `anon`/`authenticated` cannot read server-only data. Run the affected database tests plus migration-reference checks; a successful privileged migration-owner query cannot verify runtime or browser permissions. Read back remote migration history and effective privileges after an authorized deployment.

### Data invariants migrations must preserve

These are existing application contracts, not reasons to import another store's schema or data:

- **Checkout retries:** preserve request/session identity, the first verified payment, the paid delivery address, durable fulfillment phases and the saved Printify order ID. The [order store](../src/features/checkout/postgres-order-store.server.ts) commits each phase before provider calls; [fulfillment](../src/features/checkout/fulfill-checkout.server.ts) reconciles uncertain results using that identity. Resetting a claim after a lost response can print a second order.
- **Visibility and arrival:** `active` is provider publication state; `hidden_at` records an owner hide, `reveal_at` schedules visibility and `revealed_at` retains recorded reveal history. A timed reveal can be visible while `hidden_at` remains set, so preserve the [shared visibility predicate](../src/features/publishing/product-visibility-sql.ts). `added_to_shop_at` records the latest shop arrival for Newest/New, not provider creation or every republish. Preserve unknown timestamps and [visibility/arrival history](printify-catalog.md#what-the-shop-shows).
- **Category identity:** category names may change, but their [creation-time slugs](../src/features/garment-catalog/slugify-category-name.ts) are stable URL identities. A rename must not regenerate them.
- **Garment readiness:** preserve the computed completeness requirement and [concurrent writer guards](printify-catalog.md#writers-enforce-readiness-storefront-membership-stays-separate): Show and hidden-product scheduling require complete garments; an in-use ready profile cannot be cleared, and an in-use category cannot be deleted. Publication and readiness remain separate contracts.
- **Subscriber consent and suppression:** preserve the exact [consent copy version](../src/features/drop-signup/drop-consent-copy.ts), consent time and unsubscribe history. An explicit new signup refreshes consent and may lift the current unsubscribe, while the [subscriber store](../src/features/drop-signup/postgres-drop-signup-store.server.ts) retains that earlier event in `last_unsubscribed_at`. A migration must not silently clear suppression, invent consent or delete/recreate a subscriber to discard their history.

### Provision the runtime login

The baseline creates `store_app_runtime` with `LOGIN` and restricted grants, **without a password**. The project's `postgres` password does not authenticate this separate role. Keep the privileged migration connection separate from the application's `DATABASE_URL`.

Before asking the owner to enter a password, install PostgreSQL's client tools for the host if needed and verify `psql --version`; the Supabase CLI does not replace `psql`. Obtain the target project's root CA from **Database settings → SSL Configuration → Download Certificate**, save the PEM locally, and prepare the exact host, port, migration username and readable absolute certificate path. [PostgreSQL downloads](https://www.postgresql.org/download/) and [Supabase's TLS instructions](https://supabase.com/docs/guides/database/connecting-to-postgres) cover these prerequisites. Verify the tools and certificate path first so the handoff begins at the intended hidden password prompt.

1. Open an authorized migration-owner `psql` session to the correct project using the provider's actual connection details and verified TLS. Use a password prompt or an existing secure credential mechanism; do not place a password in a shell command, connection argument or SQL literal. For example, replace the non-secret placeholders here and let the owner enter the migration credential at the hidden prompt:

   ```sh
   psql -X --password 'host=POOLER_HOST port=5432 dbname=postgres user=MIGRATION_USER sslmode=verify-full sslrootcert=PROVIDER_CA_FILE'
   ```

2. Have the owner generate a high-entropy **64-character random hexadecimal password** (32 random bytes) with their trusted password manager or secure local generator, keeping the value out of chat/tool output. Hexadecimal avoids URL-reserved characters. Inside the session, run the following command and let the owner enter the password at its hidden prompts. Store it in the owner's password manager and intended secret fields. If setup is resuming with a working runtime credential, verify it instead of resetting it.

   ```text
   \password store_app_runtime
   ```

   `psql` encrypts the password before sending the role update, keeping the plaintext out of command history and the server query log. See [PostgreSQL's password command](https://www.postgresql.org/docs/current/app-psql.html#APP-PSQL-META-COMMAND-PASSWORD). Never replace this step with a password-bearing `ALTER ROLE` pasted into chat, a migration or a saved query.

3. Configure the runtime `DATABASE_URL` directly in ignored `.env.local` and the intended deployment secret field. Use this role's password; the recommended hexadecimal value needs no percent-encoding. If retaining an existing password containing reserved characters, use a trusted URL builder in the owner's secure workflow instead of asking them to encode it by hand or paste it into chat. With the **shared session pooler**, the username is `store_app_runtime.PROJECT_REF`; with a **direct database connection**, it is `store_app_runtime`. Copy the host/project reference from Supabase's Connect dialog rather than deriving them. The [Supabase connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres) documents custom-role pooler usernames. Do not deploy the `postgres` migration credential as the app login. For Supabase, also configure the downloaded full PEM certificate as `DATABASE_SSL_CA`, preserving line breaks, or an `sslrootcert` path available in the actual runtime filesystem; use only one CA source. `sslmode=verify-full` alone does not install Supabase's CA.

### Verify TLS and runtime permissions

Use a direct connection or the Supabase **session pooler on port 5432**. Transaction pooling on 6543 cannot preserve the session advisory locks and is rejected. Non-loopback URLs require `sslmode=verify-full`; Supabase hosts require the full provider CA PEM in `DATABASE_SSL_CA` or a readable runtime `sslrootcert` file. Other providers require their CA whenever it is not already trusted. Preserve line breaks and do not disable certificate verification to suppress an error. Connection URL `host` or `port` overrides are rejected. [Supabase connection options](https://supabase.com/docs/guides/database/connecting-to-postgres) describe the current provider choices.

Reconnect through the actual runtime connection, using a private password prompt, and inspect only role/privilege metadata:

```sql
select current_user, session_user, rolcanlogin, rolsuper, rolcreatedb,
       rolcreaterole, rolreplication, rolbypassrls
from pg_roles where rolname = current_user;

select has_table_privilege(current_user, 'commerce.checkout_orders', 'SELECT') as can_read_orders,
       has_table_privilege(current_user, 'commerce.checkout_orders', 'INSERT') as can_save_orders,
       has_table_privilege(current_user, 'commerce.checkout_orders', 'UPDATE') as can_update_orders,
       has_table_privilege(current_user, 'public.library_assets', 'SELECT') as can_read_private_assets;
```

Both user names must be `store_app_runtime`; `rolcanlogin` must be true and every privileged role flag must be false. The four runtime access checks must be true. Separately run `scripts/database/audit-browser-privileges.sql` with the migration-owner connection and verified TLS, using a hidden password prompt or a secure connection mechanism: `psql -X -v ON_ERROR_STOP=1 -f scripts/database/audit-browser-privileges.sql`. Prepare its host, role and CA privately as above; never paste a credential-bearing URL into command arguments. The complete browser privilege audit must return **zero rows**. It checks every effective table and sequence privilege against the browser-role contract, including inherited grants; inspect function execution separately when changing functions. The baseline intentionally grants authenticated users limited RLS-protected access to other public library tables; do not remove those policies or add broad browser grants to fix an application error. Confirm application reads/writes through this login with the setup tests. Record only safe check outcomes in setup state, never the connection URL/password.

### Configure garment categories before showing products

A fresh store has no categories or garment profiles. After the migrations and admin setup, create a category under **Products → Categories** and complete each used blueprint under **Products → Garment models**. Fill actual brand/model, material, fit, age/gender details and category. Verify current garments before showing or scheduling products. The app refuses incomplete garment setup, and feeds/health may flag active products missing complete profiles. Never import another store's category or inventory rows as an onboarding shortcut.

## Storage, email and first administrator

Follow [private library access](admin-auth.md). Configure public Supabase URL/publishable key separately from server-only owner provisioning credentials. Keep unrestricted signup disabled; configure the email provider and verified SMTP sender, with `{{ .Token }}` in invitation/confirmation/magic-link templates. Verify a real code reaches the owner before relying on email recovery.

Create separate Blob stores for **public product mockups** and **private artwork**. Configure the exact public hostname in `NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST`, with server-side `BLOB_STORE_ID`/OIDC or `BLOB_READ_WRITE_TOKEN`. Use `PRIVATE_BLOB_READ_WRITE_TOKEN` for the private store; never expose private print masters through the public optimizer.

Configure `ADMIN_OWNER_EMAIL`, `ADMIN_SETUP_SECRET` and `SUPABASE_SECRET_KEY` securely, then enable `ADMIN_LIBRARY_ENABLED` only when dependencies are ready. Disable unrestricted public signup before `/admin/setup` and record that setting as described in [admin authentication](admin-auth.md); the local checker does not verify provider settings. Keep setup disabled until both all migrations and the matching application revision are deployed; follow the [upgrade procedure](admin-auth.md#updating-an-installation-and-inspecting-an-older-claim) for an existing deployment. The app reserves a fresh account UUID, provisions only that identity and requires an email code before granting membership. An unexpected existing account stops setup; follow [setup recovery](admin-auth.md#setup-recovery) instead of adopting or deleting it automatically. A partial setup can resume with the same email/key and reserved account. Stores claimed by older code need ownership review if the account origin is uncertain. Then the owner completes `/admin/setup`, verifies email and claims membership. Keep `ADMIN_SETUP_SECRET` and `SUPABASE_SECRET_KEY` configured only until that claim is observed. Only after readback of the consumed claim and active membership, save `verification.ownerClaim` with `status: "verified"`, an ISO `verifiedAt`, the matching public `supabaseProjectUrl` and a non-secret `evidence` description. After that readback, remove both `ADMIN_SETUP_SECRET` and `SUPABASE_SECRET_KEY` from the web runtime and redeploy within existing authority. This record may waive both bootstrap credentials on resume; it does not verify current access or authorize new actions, and the checker still reports remote readiness unverified. Configure passkeys on the permanent hostname, let the owner handle device prompts, and keep email recovery usable. Verify revocation denies protected assets. The first-owner claim is permanently consumed; deleting admins must not reopen setup.

The owner can grant the agent scoped, expiring access at `/admin/agents`. Keep the downloaded file private with mode `0600`; use `DESIGN_AGENT_TOKEN_FILE` and `DESIGN_AGENT_URL`. An app grant is not a provider API key, account login or publication authorization. See [agent commands](admin-design-library.md#agent-commands).

## Printify and the first product

Follow [catalog setup](printify-catalog.md), [publishing](printify-publishing.md), and [the product skill](../.agents/skills/store-printify-product/SKILL.md). Record the actual `PRINTIFY_SHOP_ID`; this template has no saved shop or product IDs. Verify the account and shop read-only before any write.

| Credential                      | Scope/purpose                                                                                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `PRINTIFY_API_TOKEN`            | `products.read`, `orders.read`; use `shops.read` only on a setup/discovery credential; add `orders.write` only for authorized real fulfillment |
| `PRINTIFY_DRAFTS_API_TOKEN`     | Separate `products.read`, `products.write`, `uploads.write`, `catalog.read` token for private-library drafts and blueprint lookup              |
| `PRINTIFY_PUBLISHING_API_TOKEN` | Separate `products.read`, `products.write` runtime token for publishing acknowledgments                                                        |
| `PRINTIFY_WEBHOOK_ADMIN_TOKEN`  | Maintenance-only `webhooks.read`, `webhooks.write` for subscription management                                                                 |
| `PRINTIFY_WEBHOOK_SECRET`       | Independent random secret, at least 32 characters, shared only with this shop's subscription                                                   |
| `CRON_SECRET`                   | Independent random worker credential, at least 32 characters                                                                                   |
| `PRINTIFY_MONITOR_SECRET`       | Independent read-only health credential for the optional GitHub monitor                                                                        |

Recheck current provider scope requirements before creating tokens. Tokens and secrets belong in server-side secret storage. These are operation permissions, **not shop-scoped credentials**: a personal access token connects to the merchant account and its shops. The app selects `PRINTIFY_SHOP_ID`; it cannot turn an account-wide provider credential into a shop-restricted one.

The [Printify API reference](https://developers.printify.com/#authentication), checked **2026-09-27**, gives personal access tokens a **one-year lifetime**. Record only their creation/expiry dates and rotation owner in non-secret setup evidence. Replace each token before expiry, update every intended deployment/worker using it, and verify access before retiring the old token. This template uses personal access tokens, not the separate six-hour OAuth refresh flow.

[Printify API limits](https://developers.printify.com/#api-usage-guidelines), checked **2026-09-27**, are shared per account/integration, not per token: 600 requests/minute globally, 100/minute additionally for Catalog endpoints, and 200 publishing requests/30 minutes. Product/mockup creation has an additional daily limit; confirm it with Printify for large batches instead of inventing a quota. Coordinate batches and workers across shops, honor 429/backoff, and do not rotate tokens to evade limits.

Configure Printify order approval to **Manual** before live fulfillment. Stripe receives customer payments; Printify separately charges the merchant for manufacturing/shipping, so confirm its payment method/balance through the owner's secure workflow.

### Shop identity, return address and tracking emails

Before live fulfillment, open the exact shop's **Store settings → Store name** and save the owner-approved shipping-label name: **30 characters or fewer, no emoji**. Under **Ship from address**, have the owner choose the default return facility or an approved custom address, then inspect **See label example**. Do not invent an address or copy private owner details into setup state. These are per-shop settings, separate from the website display name. [Printify's shop-details guidance](https://help.printify.com/hc/en-us/articles/4483625253265-How-do-I-set-up-store-details-and-order-approval-settings), checked **2026-09-27**, documents the name limit and label fields.

Confirm who will receive and handle returns, and make the public returns instructions match that decision. [Custom return addresses](https://help.printify.com/hc/en-us/articles/4483607600401-How-can-I-set-up-a-custom-return-address-for-my-orders) depend on the selected provider and same-country fulfillment; supported address countries are currently the US, UK and Germany, excluding US territories. A saved custom address does not prove a particular provider will use it. Verify the actual label on an authorized sample shipment before claiming the result.

The app's [live fulfillment request](../src/features/checkout/fulfill-checkout.server.ts) sets `send_shipping_notification: true`, which requests Printify shipment emails; the [API flag](https://developers.printify.com/#orders) does not establish sender branding, reply handling or inbox delivery. Verify the API shop's available tracking-notification settings and the owner's chosen support/reply destination. After a separately authorized sample/live shipment to an owner-controlled address, inspect the actual received email: From address, display name, Reply-To/reply destination, brand wording, order identity and working tracking link. Record the outcome without retaining the address or email body. Do not claim an API shop automatically sends fully branded mail, or enable a paid messaging feature merely to pass this check.

Stripe receipts, Auth SMTP and [internal shipping-delay alerts](order-shipping-alerts.md) are separate channels; the reminder worker cannot email customers. [Printify Connect](https://help.printify.com/hc/en-us/articles/13348321108625-How-can-I-set-up-Printify-Connect-for-my-store) is another separately enabled Premium feature with its own post-delivery sender, not proof of API shipping-email behavior. If tracking-email delivery or reply handling remains unverified, keep it pending and establish the owner's manual customer-update process before promising automated notifications.

An empty store needs its **first** reviewed product profile: model/provider, supported variants, placement, exact approved artwork and prices. The design-page draft button copies an already published model and is unavailable until that source exists. Create the first draft with the app's explicit `drafts.create` recipe, using verified provider variants and approved pricing/placement; see [the complete first-product request](admin-design-library.md#first-product-with-an-explicit-recipe). Browser/editor inspection helps establish the recipe. Inspect actual mockups and retain exact immutable artwork provenance. Do not invent an existing product or use another shop's product as a source.

Register the signed `product:publish:started` subscription at `/api/webhooks/printify`, configure public image storage, enable publishing in the intended environment and verify the worker. Apply [background refresh operations](catalog-background-refresh.md) so availability/popularity observations are current. New stores use normal publication from reviewed app-created drafts. There is no prior-store catalog import path.

With publication authorized, publish the draft, verify acknowledgment and the stored snapshot, complete the garment/category profile, then show or schedule the product from `/admin/products`. Verify selected color/size, pricing, public mockups, and the exact approved artwork slide in the real gallery. A Printify success toast is only one receipt in that chain.

### Read-only Printify shop visibility audit

Prepare an ignored mode-0600 file containing `PRINTIFY_SHOP_ID` and the configured `PRINTIFY_API_TOKEN`, `PRINTIFY_PUBLISHING_API_TOKEN` and `PRINTIFY_DRAFTS_API_TOKEN` values through the existing secure setup workflow. Never paste credentials into chat or command arguments. Run:

```sh
node -- scripts/template/printify-shop-scope.mjs --env-file .tmp/printify-audit.env
```

The audit only calls Printify's [read-only shop list](https://developers.printify.com/#shops), using each supplied token. It fails if the configured shop is absent and warns about the count of other visible shops. Extra shops require review of the owner-accepted shared-account exception. Exit 0 confirms visibility for all supplied tokens; exit 1 reports invalid input or a missing shop; exit 2 keeps visibility unverified after denied or unavailable requests. A 403 may reflect intentionally missing `shops.read`: do not broaden runtime scopes merely to pass. Verify the account through the existing owner/setup workflow and retain the token-level visibility gap as unverified. The audit cannot prove account isolation or other permissions, and `setup:check` never invokes it. Remove the temporary secret file when finished.

## Stripe-hosted Checkout

Start in the intended Stripe **sandbox/test** environment. Configure a restricted server key in `STRIPE_SECRET_KEY`, following [the Checkout skill](../.agents/skills/store-stripe-checkout/SKILL.md). No browser publishable key is needed for hosted redirect Checkout. CLI login alone does not populate this application's server key.

Before testing Checkout through the store, finish the brand, owner-reviewed policy text and shipping configuration, set their readiness gates truthfully, publish/show one reviewed product within authorization, and initialize fresh stock. `createCheckout` applies those setup gates to sandbox payments too. Keep real fulfillment disabled; making sandbox Checkout reachable is not live activation.

Create or reuse the snapshot webhook at `https://YOUR-DOMAIN/api/webhooks/stripe`. Read the API version from `src/features/checkout/get-commerce-services.server.ts`; do not upgrade it incidentally. Subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed`, then store the destination's secret as `STRIPE_WEBHOOK_SECRET`. Read back account, environment, URL, events and payload version.

For local work, `stripe listen --forward-to localhost:3000/api/webhooks/stripe` supplies a separate local signing secret. Restart after environment changes. Keep `PRINTIFY_FULFILLMENT_ENABLED=false` during sandbox work. Test payments independently cannot print even if the flag is accidentally true; live Checkout is blocked when real fulfillment is disabled.

Shipping amounts and supported destination rules must match the owner's public policy, product profiles, cart, checkout, structured data and merchant account. Current code uses a flat first/additional-shirt shipping calculation. A different calculation is an implementation change. Leave `STRIPE_TAX_ENABLED=false` unless the owner's Stripe Tax setup and applicable registrations are established; false means this integration collects no tax. Code checks do not determine the merchant's legal obligations.

### Customer receipts and public business details

Complete these Dashboard settings in the intended account/environment before claiming payment setup is complete. Official Stripe guidance checked **2026-09-27**:

1. Under **Settings → Business → Business details → Public details**, enter the owner's reviewed public business/support information and privacy URL. Verify the receipt preview uses this store's identity. Stripe's [receipt guide](https://docs.stripe.com/receipts) identifies the required legal name, support address/email and privacy URL; private onboarding facts still belong in Stripe's secure forms.
2. Set the recognizable statement descriptor in **Business details**. Follow [Stripe's descriptor requirements](https://docs.stripe.com/get-started/account/statement-descriptors): 5–22 Latin characters, at least one letter, permitted punctuation and a recognizable DBA. The current Checkout code does not set a transaction-specific descriptor suffix, so account settings supply that identity.
3. Under **Settings → Business → Customer emails**, enable **Successful payments** and the owner's chosen **Refunds** receipt setting. Review branding and send a test preview/manual test-payment receipt to the intended owner address within authorization. Stripe requires manual sending for test-payment receipts; a sandbox success does not prove automatic live email delivery. Record configured settings, actual received email and any authorized live receipt separately.

The app does not enable one-time paid invoices with `invoice_creation`. Receipt configuration does not authorize adding that separately priced feature. During an authorized live purchase, verify the receipt and calculated descriptor independently of webhook delivery, fulfillment and bank-statement display.

## Verify before accepting real orders

Use the store to test single- and multi-shirt totals, unavailable variants, Checkout opening, cancel/return and a complete Stripe test payment. Verify the signed webhook reaches the correct app, the durable order is simulated, the return page reflects it, and Printify has **no new order**. Replay the actual completed event and confirm it reuses the same row. A generic `stripe trigger` fixture lacks this store's saved checkout snapshot and is not a fulfillment test.

Use disposable local databases for automated tests, never a store database. Follow [local test prerequisites](ci.md#local-test-prerequisites) and [test-store isolation](test-store.md). The exact test names and required environment variables live in `.github/workflows/check.yml`, `.github/workflows/integration.yml` and each suite. Separate suites reset schemas and require separate databases. A skipped integration test is not a pass.

Use the setup checker in the intended mode. It validates local configuration without making provider requests or printing secret values. It follows Next.js environment-file precedence for the current `NODE_ENV`; use `NODE_ENV=production pnpm setup:check --launch` when inspecting production-mode local configuration. It does not fetch deployment secrets or prove the deployed environment matches:

| Command                      | What a passing configuration establishes                                                                        | What still needs evidence                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `pnpm setup:check`           | Reports `CONFIGURED`, `OFF` and `TODO` using runtime environment/config constraints                             | This diagnostic mode may exit successfully with TODOs; read the report                                                        |
| `pnpm setup:check --sandbox` | Required setup gates, sandbox/test Stripe keys and fulfillment disabled; no production cron requirement         | Authenticated worker calls, fresh stock, actual sandbox Checkout and signed webhook simulation                                |
| `pnpm setup:check --launch`  | Live Stripe keys, fulfillment enabled and the exact reviewed Vercel worker schedules, plus required setup gates | Authorized deployment/activation, registered schedules, successful recurring work, live callbacks and any authorized purchase |

For a protected dotenv export, use `pnpm setup:check -- --launch --env-file .tmp/setup-production.env`. Keep the `--` argument separator: it prevents Node/pnpm startup from interpreting the checker's `--env-file` option. The checker reads only that file's literal values (defaulting its `NODE_ENV` to `production`); it does not load or change `.env.local`, expand shell variables, or merge ambient credentials. Keep the file private and delete it after inspection. Never enable real fulfillment in the developer's environment merely to obtain a passing report. A pulled configuration is still separate from the revision and environment actually deployed.

Both strict modes exit unsuccessfully when required keys are absent or readable checks fail. In explicit-export mode, unreadable values alone do not fail the command or count as configured; retain those evidence gaps in the launch receipt. Disabled library, reminders and marketing features are not universal launch prerequisites; enabled features and any supplied optional values must satisfy their requirements. `OFF` means intentionally disabled, not remotely verified. Every mode reports remote readiness **UNVERIFIED**. Opaque provider tokens are checked for presence, known placeholders and single-line shape; no undocumented token length is invented. Credential shape does not prove a token works, and passing policy checks cannot approve its content.

For sandbox work on localhost or preview, invoke the authenticated publishing worker directly as needed and initialize stock/popularity through [manual refresh POSTs](catalog-background-refresh.md#setup-and-verification), then run the actual store journey before stock expires. Production cron does not run there. Run `pnpm check` and, with the [local prerequisites](#local-verification-prerequisites), `pnpm check:all`. Provider identity, permissions, webhook delivery, passkeys, SMTP receipt, manufacturing and production deployment still need direct evidence.

For an authorized launch, verify the final deployed revision, permanent domain, enabled workers and signed callbacks. A live purchase requires actual owner authorization for item, amount and fulfillment. Verify one payment, one Printify order, exact variant/address/quantity and actual production status. Physical sample quality, delivery, merchant approval and traffic remain separate evidence. Do not automatically charge or manufacture a test order simply because setup was requested.

## Merchant feeds and Meta checkout

Feeds use the same published visible variants as the store. Configure independent random 32–256 character passwords: `GOOGLE_MERCHANT_FEED_PASSWORD` with username `google-merchant` at `/feeds/google`, and `META_CATALOG_FEED_PASSWORD` with username `meta-catalog` at `/feeds/meta`. Keep passwords in the provider's authentication fields, never URLs. Verify authenticated XML, prices, images and variant identifiers before saving scheduled sources. Domain verification, claim, fetched feed, processed items and listing/Shop approval are distinct results.

Set Meta's checkout URL to the canonical `/checkout/meta` path. It accepts exact feed IDs in `products=<product-id>-<variant-id>:<quantity>`, then asks the shopper to add the resolved selection to their cart. Coupons are not supported: nonempty `coupon` values reject the handoff. Validate the deployed integration with the provider's current tester before publishing a Shop. See [Google Merchant skill](../.agents/skills/store-google-merchant/SKILL.md).

## Conversion measurement

Vercel events summarize product views, additions, checkout starts and verified live-paid returns. Current event/plan support must be checked on the new account. Browser attribution and deduplication are best effort; Stripe remains authoritative for sales/revenue. Test and simulated payments must not emit purchase events to production destinations.

[Meta Pixel](meta-pixel.md) and [Google purchases](google-conversions.md) default off and need separate current visitor consent, verified account settings and authorized production activation. Reuse no analytics IDs. Verify ordinary receipt and purchase receipt independently; never send synthetic production purchases to prove a tag exists.

## Operations and recovery

Prepare a support owner and verified contact destination before selling. Follow [orders/attribution](order-attribution.md), [delivery expectations](delivery-expectations.md), and optional [shipping alerts](order-shipping-alerts.md) and [drop emails](drop-emails.md). Optional alert and drop emails need independent Resend credentials and real receipt verification; Auth SMTP setup does not configure them.

Keep webhook failure and worker monitoring visible. An uncertain Printify create or submit must be reconciled with the saved payment/provider identity before a retry; do not reset claims or create replacements because a response was lost. Use [order recovery](../.agents/skills/store-order-recovery/SKILL.md) for paid orders and [publishing recovery](../.agents/skills/store-publishing-recovery/SKILL.md) for catalog jobs. Preserve evidence and record a precise resume point when owner participation is needed.

## Activate signup confirmation separately

New drop signups require verified inbox confirmation under [the signup runbook](drop-signup.md#inbox-confirmation-and-release). Keep `SIGNUP_CONFIRMATIONS_ENABLED=false` until the reviewed production sender, HTTPS origin and authenticated 15-minute confirmation worker are configured. Existing consent versions remain immutable; new consent is v3. `DROP_EMAILS_ENABLED` remains an independent default-off marketing decision. Apply the new incremental migration before deploying this flow to a populated store, with both workers drained and historical rows verified as legacy. A configured sender proves no actual inbox receipt.

Retained signup lists also require the authenticated 15-minute worker for automatic pending expiry, even with `SIGNUP_CONFIRMATIONS_ENABLED=false` and `DROP_EMAILS_ENABLED=false`. The local setup check requires the schedule and published disclosure independently of sender readiness. Confirmed, historical and unsubscribed rows remain until reviewed erasure.
