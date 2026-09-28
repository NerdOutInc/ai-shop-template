# Set up your store with an agent

The normal workflow is **Use this template → clone → ask an agent to set up the store**. The agent reads [the setup skill](../.agents/skills/store-setup/SKILL.md), asks for missing choices, prepares accounts and configuration, and verifies each result. The owner signs in, supplies business facts and chooses designs. Nobody needs to become a part-time webhook archaeologist.

## Resume and tool discovery

Copy `store-setup.example.json` to ignored `.store-setup.local.json`. Keep public brand choices, delegated rules, safe resource identifiers, status, verification evidence and the next action there. Do not store credentials, account usernames, private owner contact information, login links, email codes or customer data. Local `.env.local`, deployment secrets and private grant files are different storage destinations. Commit permanent public choices in `src/lib/store-config.ts` and approved public brand assets.

Discover the host's available browser, computer, connector, CLI and image tools. Repository skills describe workflows; they do not install or grant access to Browser, Computer, image generation or provider accounts. Prefer purpose-built APIs or CLIs when they cover the task; otherwise operate the actual dashboard with browser/computer tools. Read the current provider documentation before relying on changing UI labels, plans, scopes or pricing.

Prepare forms first, then let the owner enter usernames/passwords, email codes, 2FA, CAPTCHA, passkeys and OS **Yes/OK** permissions directly. Ask for a non-secret completion signal and read back the resulting state. Never ask for secrets in chat, copy cookies or bypass a security prompt. Missing tools require a precise handoff, not a claim that setup was verified.

## Intake and design

Ask a short first round about brand name, audience, existing domain/assets/accounts, visual direction, products, selling region and budget. Offer generated alternatives for storefront concepts, logo, favicon and color palettes. Ask which explorations the owner wants and their count, show the options, and implement the selected direction while preserving original/approved assets.

Resolve prices or a margin rule, garment colors/sizes/provider, shipping charges, delivery promises, support contact, policies, IANA time zone, weekly feature day/time and delegated product choices before their dependent step. Follow [owner intake](../.agents/skills/store-owner-handoff/references/owner-intake.md). Reuse existing answers; missing information is not permission to invent a merchant policy.

The current commerce implementation supports **USD, standard shipping to the 50 US states plus DC**. The first supported draft model is Next Level 6210. Territory/military/international destinations, currency conversion, coupon offers and arbitrary shipping models are not provided simply by editing a label. Additional garments need verified production settings and complete merchant profiles; wider commerce changes need coordinated implementation and tests.

Customize `src/lib/store-config.ts`, public identity assets, theme and home copy. Set `timeZone` and `weeklyFeature` to the owner’s chosen wall-clock schedule; the neutral default is Monday at 09:00 UTC. `configured`, `policies.published` and `commerce.shippingConfirmed` start false. Set them true only after implementing the actual brand, owner-reviewed policy text, shipping amounts and delivery estimates. Paid Checkout is blocked until these gates are complete. A schema passing validation cannot establish that a shipping promise is accurate or a policy is appropriate.

## Dependency order

| Phase                 | Agent work                                                                         | Owner participation                                    | Evidence before proceeding                                        |
| --------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------- |
| Local baseline        | Install pinned tools; run setup check; inspect neutral shell                       | Brand and business answers                             | Clean local configuration report and visible shell                |
| Repository/deployment | Verify new repository; prepare Vercel project and domain configuration             | Sign-in, uncovered costs/terms/DNS authorization       | Exact repository, deployment project and intended origin          |
| Database/Auth         | Apply fresh baseline to new Supabase project; provision restricted runtime access  | Sign-in and secure credential entry                    | Migration history, runtime-role grants, verified TLS              |
| Storage/email/admin   | Separate private/public Blob stores; SMTP; first-owner enrollment                  | Email verification and device passkey prompts          | Actual email receipt, admin access and protected download         |
| Printify              | Dedicated API shop, scoped tokens, draft/product profile and publishing connection | Sign-in, billing/account checks, publication choice    | Correct shop, signed event, durable snapshot and hosted images    |
| Stripe sandbox        | Restricted test key, signed Checkout webhook, store test                           | Secure key entry and test form as required             | Simulated paid order and zero Printify orders                     |
| Storefront/policies   | Complete garment/category records; verify product and policy consistency           | Approved public choices                                | Desktop/mobile/keyboard checks, feeds match product variants      |
| Launch                | Prepare verified configuration and exact activation actions                        | Uncovered production, cost and live-purchase decisions | Deployed revision, webhook/worker evidence and actual live result |

Each store has its own repository, domain, deployment, Supabase project, Printify shop, Stripe account and separate private/public storage. A provider account can be owned by the same person, but do not borrow another store's shop, credentials, data or callback subscription. Reuse existing resources dedicated to this store after verifying them; do not create duplicates after a timeout.

## Personalize the generated repository

Verify `git remote -v` points to the owner's newly generated repository. Rename `package.json`’s `name` to the new project’s package-safe name. Replace this template’s README title, starter links and store-facing instructions with the new store’s repository/admin/setup links; preserve the [template provenance](template-origin.md) and license attribution.

Review `.github/workflows/` against the new remote and default branch. The baseline Check workflow targets `main`; adjust that branch filter if the owner chose another name. The optional monitor derives the repository from GitHub's runtime context and runs on its default branch, but still needs this repository’s own health URL, secret, enablement and optional incident assignee. Verify generated issue/recovery links and intended repository permissions before enabling it. Do not copy another repository’s secrets or incident settings.

## Local baseline and deployment

Use Node 24.15 or later within Node 24 and the pnpm version pinned in `package.json`:

```sh
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm setup:check
pnpm dev
```

The no-secret shell is available at `http://localhost:3000`; provider-backed catalog/checkout stay unavailable until configured. The template does not include demo orders, designs or a public product seed.

Connect only the new repository to the intended Vercel project. The default `vercel.json` has no worker schedules. Review `scripts/vercel-crons.example.json`, verify hosting-plan support and merge the needed entries explicitly before enabling the integrations. Verify current plan/cost limits and owner authorization before incurring a subscription. Preview deployments require separate data/storage and direct worker test calls because production cron schedules do not run on previews.

Set `NEXT_PUBLIC_SITE_URL` to the permanent HTTPS origin for production. Public variables, canonical identity and the public Blob hostname are embedded at build time, so rebuild after changing them. Verify domain/DNS and the final deployment independently. Enabling GitHub's Template repository setting is only needed on the template's repository, not every generated store.

## Database and TLS

Create or verify the store's own Supabase project. Apply `supabase/migrations/20260928000354_storefront_baseline.sql` to the new empty database using an authorized migration connection. This is the template’s single fresh-schema baseline. Do not copy a prior store's database, Auth users, grants or seed products. No production migration history from another project proves this database is ready.

### Provision the runtime login

The baseline creates `store_app_runtime` with `LOGIN` and restricted grants, **without a password**. The project's `postgres` password does not authenticate this separate role. Keep the privileged migration connection separate from the application's `DATABASE_URL`.

1. Open an authorized migration-owner `psql` session to the correct project using the provider's actual connection details and verified TLS. Use a password prompt or an existing secure credential mechanism; do not place a password in a shell command, connection argument or SQL literal. For example, replace the non-secret placeholders here and let the owner enter the migration credential at the hidden prompt:

   ```sh
   psql -X --password 'host=POOLER_HOST port=5432 dbname=postgres user=MIGRATION_USER sslmode=verify-full sslrootcert=PROVIDER_CA_FILE'
   ```

2. Inside that session, run the following command and have the owner enter a newly generated runtime password at its hidden prompts. Store it in the owner's password manager and intended secret fields. If setup is resuming with a working runtime credential, verify it instead of resetting it.

   ```text
   \password store_app_runtime
   ```

   `psql` encrypts the password before sending the role update, keeping the plaintext out of command history and the server query log. See [PostgreSQL's password command](https://www.postgresql.org/docs/current/app-psql.html#APP-PSQL-META-COMMAND-PASSWORD). Never replace this step with a password-bearing `ALTER ROLE` pasted into chat, a migration or a saved query.

3. Configure the runtime `DATABASE_URL` directly in ignored `.env.local` and the intended deployment secret field. Use this role's password, percent-encoded for a connection URL. With the **shared session pooler**, the username is `store_app_runtime.PROJECT_REF`; with a **direct database connection**, it is `store_app_runtime`. Copy the host/project reference from Supabase's Connect dialog rather than deriving them. The [Supabase connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres) documents custom-role pooler usernames. Do not deploy the `postgres` migration credential as the app login.

### Verify TLS and runtime permissions

Use a direct connection or the Supabase **session pooler on port 5432**. Transaction pooling on 6543 cannot preserve the session advisory locks and is rejected. Non-loopback URLs require `sslmode=verify-full`; include the full provider CA PEM in `DATABASE_SSL_CA` when necessary. Preserve line breaks and do not disable certificate verification to suppress an error. Connection URL `host` or `port` overrides are rejected. [Supabase connection options](https://supabase.com/docs/guides/database/connecting-to-postgres) describe the current provider choices.

Reconnect through the actual runtime connection, using a private password prompt, and inspect only role/privilege metadata:

```sql
select current_user, session_user, rolcanlogin, rolsuper, rolcreatedb,
       rolcreaterole, rolreplication, rolbypassrls
from pg_roles where rolname = current_user;

select has_table_privilege(current_user, 'commerce.checkout_orders', 'SELECT') as can_read_orders,
       has_table_privilege(current_user, 'commerce.checkout_orders', 'INSERT') as can_save_orders,
       has_table_privilege(current_user, 'commerce.checkout_orders', 'UPDATE') as can_update_orders,
       has_table_privilege(current_user, 'public.library_assets', 'SELECT') as can_read_private_assets;

select browser_role, n.nspname as schema_name, c.relname as object_name
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join (values ('anon'), ('authenticated')) as browser_roles(browser_role)
where c.relkind in ('r', 'v', 'm', 'p')
  and (n.nspname in ('commerce', 'private')
       or (n.nspname = 'public' and c.relname = 'library_assets'))
  and has_table_privilege(browser_role, c.oid, 'SELECT,INSERT,UPDATE,DELETE');
```

Both user names must be `store_app_runtime`; `rolcanlogin` must be true and every privileged role flag must be false. The four runtime access checks must be true, and the browser-role query must return **zero rows**. The baseline intentionally grants authenticated users limited RLS-protected access to other public library tables; do not remove those policies or add broad browser grants to fix an application error. Confirm application reads/writes through this login with the setup tests. Record only safe check outcomes in setup state, never the connection URL/password.

### Garment categories: apply then deploy

A fresh store has no categories or garment profiles. After the migrations and admin setup, create a category under **Products → Categories** and complete each used blueprint under **Products → Garment models**. Fill actual brand/model, material, fit, age/gender details and category. Verify current garments before showing or scheduling products. The app refuses incomplete garment setup, and feeds/health may flag active products missing complete profiles. Never import another store's category or inventory rows as an onboarding shortcut.

## Storage, email and first administrator

Follow [private library access](admin-auth.md). Configure public Supabase URL/publishable key separately from server-only owner provisioning credentials. Keep unrestricted signup disabled; configure the email provider and verified SMTP sender, with `{{ .Token }}` in invitation/confirmation/magic-link templates. Verify a real code reaches the owner before relying on email recovery.

Create separate Blob stores for **public product mockups** and **private artwork**. Configure the exact public hostname in `NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST`, with server-side `BLOB_STORE_ID`/OIDC or `BLOB_READ_WRITE_TOKEN`. Use `PRIVATE_BLOB_READ_WRITE_TOKEN` for the private store; never expose private print masters through the public optimizer.

Configure `ADMIN_OWNER_EMAIL`, `ADMIN_SETUP_SECRET` and `SUPABASE_SECRET_KEY` securely, then enable `ADMIN_LIBRARY_ENABLED` only when dependencies are ready. The owner completes `/admin/setup`, verifies email and claims membership. Configure passkeys on the permanent hostname, let the owner handle device prompts, and keep email recovery usable. Verify revocation denies protected assets. The first-owner claim is permanently consumed; deleting admins must not reopen setup.

The owner can grant the agent scoped, expiring access at `/admin/agents`. Keep the downloaded file private with mode `0600`; use `DESIGN_AGENT_TOKEN_FILE` and `DESIGN_AGENT_URL`. An app grant is not a provider API key, account login or publication authorization. See [agent commands](admin-design-library.md#agent-commands).

## Printify and the first product

Follow [catalog setup](printify-catalog.md), [publishing](printify-publishing.md), and [the product skill](../.agents/skills/store-printify-product/SKILL.md). Record the actual `PRINTIFY_SHOP_ID`; this template has no saved shop or product IDs. Verify the account and shop read-only before any write.

| Credential                      | Scope/purpose                                                                                                                     |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `PRINTIFY_API_TOKEN`            | `products.read`, `shops.read`, `orders.read`; add `orders.write` only for authorized real fulfillment                             |
| `PRINTIFY_DRAFTS_API_TOKEN`     | Separate `products.read`, `products.write`, `uploads.write`, `catalog.read` token for private-library drafts and blueprint lookup |
| `PRINTIFY_PUBLISHING_API_TOKEN` | Separate `products.read`, `products.write` runtime token for publishing acknowledgments                                           |
| `PRINTIFY_WEBHOOK_ADMIN_TOKEN`  | Maintenance-only `webhooks.read`, `webhooks.write` for subscription management                                                    |
| `PRINTIFY_WEBHOOK_SECRET`       | Independent random secret, at least 32 characters, shared only with this shop's subscription                                      |
| `CRON_SECRET`                   | Independent random worker credential, at least 32 characters                                                                      |
| `PRINTIFY_MONITOR_SECRET`       | Independent read-only health credential for the optional GitHub monitor                                                           |

Recheck current provider scope requirements before creating tokens. Tokens and secrets belong in server-side secret storage. Configure Printify order approval to **Manual** before live fulfillment. Stripe receives customer payments; Printify separately charges the merchant for manufacturing/shipping, so confirm its payment method/balance through the owner's secure workflow.

An empty store needs its **first** reviewed product profile: model/provider, supported variants, placement, exact approved artwork and prices. The design-page draft button copies an already published model and is unavailable until that source exists. Create the first draft with the app's explicit `drafts.create` recipe, using verified provider variants and approved pricing/placement; see [the complete first-product request](admin-design-library.md#first-product-with-an-explicit-recipe). Browser/editor inspection helps establish the recipe. Inspect actual mockups and retain exact immutable artwork provenance. Do not invent an existing product or use another shop's product as a source.

Register the signed `product:publish:started` subscription at `/api/webhooks/printify`, configure public image storage, enable publishing in the intended environment and verify the worker. Apply [background refresh operations](catalog-background-refresh.md) so availability/popularity observations are current. New stores use normal publication from reviewed app-created drafts. There is no prior-store catalog import path.

With publication authorized, publish the draft, verify acknowledgment and the stored snapshot, complete the garment/category profile, then show or schedule the product from `/admin/products`. Verify selected color/size, pricing, public mockups, and the exact approved artwork slide in the real gallery. A Printify success toast is only one receipt in that chain.

## Stripe-hosted Checkout

Start in the intended Stripe **sandbox/test** environment. Configure a restricted server key in `STRIPE_SECRET_KEY`, following [the Checkout skill](../.agents/skills/store-stripe-checkout/SKILL.md). No browser publishable key is needed for hosted redirect Checkout. CLI login alone does not populate this application's server key.

Create or reuse the snapshot webhook at `https://YOUR-DOMAIN/api/webhooks/stripe`. Read the API version from `src/features/checkout/get-commerce-services.server.ts`; do not upgrade it incidentally. Subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed`, then store the destination's secret as `STRIPE_WEBHOOK_SECRET`. Read back account, environment, URL, events and payload version.

For local work, `stripe listen --forward-to localhost:3000/api/webhooks/stripe` supplies a separate local signing secret. Restart after environment changes. Keep `PRINTIFY_FULFILLMENT_ENABLED=false` during sandbox work. Test payments independently cannot print even if the flag is accidentally true; live Checkout is blocked when real fulfillment is disabled.

Shipping amounts and supported destination rules must match the owner's public policy, product profiles, cart, checkout, structured data and merchant account. Current code uses a flat first/additional-shirt shipping calculation. A different calculation is an implementation change. Leave `STRIPE_TAX_ENABLED=false` unless the owner's Stripe Tax setup and applicable registrations are established; false means this integration collects no tax. Code checks do not determine the merchant's legal obligations.

## Verify before accepting real orders

Use the store to test single- and multi-shirt totals, unavailable variants, Checkout opening, cancel/return and a complete Stripe test payment. Verify the signed webhook reaches the correct app, the durable order is simulated, the return page reflects it, and Printify has **no new order**. Replay the actual completed event and confirm it reuses the same row. A generic `stripe trigger` fixture lacks this store's saved checkout snapshot and is not a fulfillment test.

Use disposable local databases for automated tests, never a store database. The exact test names and required environment variables live in `.github/workflows/check.yml` and each suite. Separate suites reset schemas and require separate databases. A skipped integration test is not a pass.

Run `pnpm check` and, with the required local Supabase/Postgres/browser dependencies, `pnpm check:all`. Run `pnpm setup:check --launch` before the concrete launch decision. It checks configuration only: provider identity, permissions, webhook delivery, passkeys, SMTP receipt, manufacturing and production deployment still need direct evidence.

For an authorized launch, verify the final deployed revision, permanent domain, enabled workers and signed callbacks. A live purchase requires actual owner authorization for item, amount and fulfillment. Verify one payment, one Printify order, exact variant/address/quantity and actual production status. Physical sample quality, delivery, merchant approval and traffic remain separate evidence. Do not automatically charge or manufacture a test order simply because setup was requested.

## Merchant feeds and Meta checkout

Feeds use the same published visible variants as the store. Configure independent random 32–256 character passwords: `GOOGLE_MERCHANT_FEED_PASSWORD` with username `google-merchant` at `/feeds/google`, and `META_CATALOG_FEED_PASSWORD` with username `meta-catalog` at `/feeds/meta`. Keep passwords in the provider's authentication fields, never URLs. Verify authenticated XML, prices, images and variant identifiers before saving scheduled sources. Domain verification, claim, fetched feed, processed items and listing/Shop approval are distinct results.

Set Meta's checkout URL to the canonical `/checkout/meta` path. It accepts exact feed IDs in `products=<product-id>-<variant-id>:<quantity>`, then asks the shopper to add the resolved selection to their cart. Coupons are not supported: nonempty `coupon` values reject the handoff. Validate the deployed integration with the provider's current tester before publishing a Shop. See [Google Merchant skill](../.agents/skills/store-google-merchant/SKILL.md).

## Conversion measurement

Vercel events summarize product views, additions, checkout starts and verified live-paid returns. Current event/plan support must be checked on the new account. Browser attribution and deduplication are best effort; Stripe remains authoritative for sales/revenue. Test and simulated payments must not emit purchase events to production destinations.

[Meta Pixel](meta-pixel.md) and [Google purchases](google-conversions.md) default off and need separate current visitor consent, verified account settings and authorized production activation. Reuse no analytics IDs. Verify ordinary receipt and purchase receipt independently; never send synthetic production purchases to prove a tag exists.

## Operations and recovery

Prepare a support owner and verified contact destination before selling. Follow [orders/attribution](order-attribution.md), [delivery expectations](delivery-expectations.md), and optional [shipping alerts](order-shipping-alerts.md). Optional email alerts need independent Resend credentials and real receipt verification; Auth SMTP setup does not configure them.

Keep webhook failure and worker monitoring visible. An uncertain Printify create or submit must be reconciled with the saved payment/provider identity before a retry; do not reset claims or create replacements because a response was lost. Use [order recovery](../.agents/skills/store-order-recovery/SKILL.md) for paid orders and [publishing recovery](../.agents/skills/store-publishing-recovery/SKILL.md) for catalog jobs. Preserve evidence and record a precise resume point when owner participation is needed.
