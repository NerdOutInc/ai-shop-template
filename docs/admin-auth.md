# Private library access

The concept library belongs to this store. Browsing, data access, and artwork downloads require an active administrator. The public shop still works when the library is disabled or Supabase Auth is unavailable.

## Configure a store

Keep `ADMIN_LIBRARY_ENABLED=false` while preparing the deployment. Use the store's own Supabase project and private Blob store; never carry another brand's users, grants, favorites, or artwork into a new template instance.

1. Apply all checked-in migrations to the new store database with `supabase db push` within the owner's authorized scope, including [verified owner enrollment](../supabase/migrations/20260928203733_verified_owner_enrollment.sql), then [provision and verify the restricted runtime login](store-setup.md#provision-the-runtime-login). The baseline creates `store_app_runtime` without a password; it does not configure a working application credential by itself.
2. Set `DATABASE_URL` to the Supabase session pooler on 5432 using `store_app_runtime.PROJECT_REF` and its privately provisioned password, with verified TLS. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. These two Auth settings are deliberately public; database credentials and `SUPABASE_SECRET_KEY` are server-only.
3. **Before the first `/admin/setup`, disable unrestricted signup in Supabase Auth**, while leaving the email provider enabled for existing users. Record the project, verification time and non-secret evidence that signup was disabled before owner setup. Keep this private library invitation-only; neither `setup:check` nor the claim path verifies this provider setting. The [owner enrollment guarantee](#owner-enrollment-guarantee) also rejects accounts created outside setup when signup is accidentally left enabled. In local CLI configuration these are separate settings: `[auth] enable_signup=false` and `[auth.email] enable_signup=true`. Set the intended `ADMIN_OWNER_EMAIL`, a random `ADMIN_SETUP_SECRET` of at least 32 characters, and the server-only `SUPABASE_SECRET_KEY` that can provision that owner. Keep the setup secret in the deployment's secret manager; do not put it in chat, Git, a URL, or analytics.
4. Configure Supabase email delivery with the owner's SMTP provider and verify email-code delivery. Include `{{ .Token }}` in the invitation, confirmation, and magic-link email templates so the owner receives the code that the app requests. The default sender's restrictions make it unsuitable as the store's production recovery channel.
5. Enable Supabase's passkey feature and set its relying-party ID to the store's permanent hostname. Allow the exact HTTPS site origin. Local development uses `localhost` as its relying-party ID (numeric loopback IPs are invalid passkey relying parties), and disposable preview hostnames must not enroll production passkeys. Native Supabase passkeys are currently experimental; email sign-in remains available.
6. Set `PRIVATE_BLOB_READ_WRITE_TOKEN` to a **separate private** Vercel Blob store. The public product-mockup store continues serving shop and Merchant images. Private artwork must not use that store or its credentials.
7. Enable `ADMIN_LIBRARY_ENABLED` in the authorized environment and visit `/admin/setup`. Enter the owner setup proof and complete Supabase email verification, then claim the administrator account. Add a passkey from `/admin/account`.

## Owner enrollment guarantee

First-owner setup reserves a random Auth user UUID and the configured email in `private.admin_setup_state` **before** contacting Supabase. It uses the server-only [Admin create-user API](https://supabase.com/docs/reference/javascript/auth-admin-createuser) to create that exact UUID. It never invites, updates or adopts an unrelated existing account because its email matches. An email conflict stops setup with recovery instructions.

The new Auth account is created with `email_confirm: true` and no supplied password. This allows `signInWithOtp({ shouldCreateUser: false })` to send a code while public signup is disabled. An unconfirmed account takes Supabase's signup-confirmation path, which is blocked in that production configuration. Public signup itself does not update an existing account's credentials. Supabase generates a random password internally when none is supplied; the app never receives or distributes it. **The provider's confirmed flag is not proof of mailbox ownership:** the app separately sends a [sign-in OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless), verifies that code and reads the current Auth user before granting membership. Both the OTP result and current user must have the reserved UUID and the configured confirmed email. The database claim independently requires that enrollment UUID/email, an eligible current identity and unused setup state.

If a request or email delivery fails, retry `/admin/setup` with the same email and setup key. The reservation survives restarts; a duplicate-create response can resume only the exact saved UUID. It cannot turn a different account into the owner. If the deployment owner corrects `ADMIN_OWNER_EMAIL` before setup is claimed, the next valid setup request atomically reserves a fresh UUID for that address. Only the current reservation can be claimed; an old code/account cannot claim the corrected enrollment. Once setup is consumed or an administrator is active, rotation is refused. Abandoned accounts remain unprivileged and are left for project-owner review rather than being deleted automatically.

A database transaction serializes the first claim against another browser and dashboard membership writes. The setup claim is consumed permanently; removing every admin never reopens ownership to the next visitor. The sign-in page is not a game of king of the hill.

This flow addresses [admin-1 / #17](https://github.com/NerdOutInc/ai-shop-template/issues/17) for new owner setup. Applying the migration does not repair credentials or ownership established by older code. Existing memberships and consumed claims remain unchanged and require provider-led review if their origin is uncertain.

## Setup recovery

- **No code or interrupted setup:** check SMTP, the magic-link template's `{{ .Token }}`, provider rate limits, credentials and the intended project. Request another code with the same owner email/key; do not reset the reservation or consume a claim manually.
- **Unexpected existing account:** stop. The Supabase project owner must inspect the account and its origin in **Authentication → Users**. Never promote it merely because an email code succeeds, and never automatically delete an account to clear the error. For a registration the project owner has verified is disposable and unused (whether or not its email is confirmed), the project owner can revoke its sessions and remove it using supported Auth administration, then retry the same email. The saved reservation will create a fresh UUID without carrying over that account's password, passkeys or identities. Existing access tokens can remain valid until expiry, so an account that ever held privileges needs the existing-store recovery procedure below instead.
- **Wrong configured email before a claim:** disable setup on the old deployment, correct `ADMIN_OWNER_EMAIL` in the intended environment, deploy the corrected configuration and re-enable setup. Request a new code for that email with the setup key. The app rotates the unclaimed reservation; do not edit database state or update the abandoned Auth account's email. Review orphaned accounts separately; their old codes cannot claim the new reservation. Existing accounts with data require provider-supported recovery, not deletion as a login shortcut.
- **Previously claimed store:** first disable uncertain memberships, recover the intended account through Supabase's supported recovery process, review and revoke untrusted sessions and credentials (including passwords, passkeys and linked identities), and only then restore vetted membership. Revocation blocks this app even while an old access token remains valid. Keep the consumed claim intact; `/admin/setup` is not an existing-store recovery tool.

## Updating an installation and inspecting an older claim

Keep `ADMIN_LIBRARY_ENABLED=false` and redeploy **before** applying this migration or changing owner configuration. Apply all migrations, deploy the matching application code, verify both revisions, and only then re-enable the library. Otherwise the old invitation-based code can create a conflicting account in the migration/code deployment gap. For an operating library, removing `ADMIN_SETUP_SECRET` and redeploying first disables only bootstrap while existing admins retain access; leave that secret absent if setup is already consumed.

After all migrations are applied, run [inspect-owner-enrollment.sql](../scripts/database/inspect-owner-enrollment.sql) through the Supabase SQL Editor or with the migration-owner connection and verified TLS (`psql -X -v ON_ERROR_STOP=1 -f scripts/database/inspect-owner-enrollment.sql`). The restricted runtime login intentionally cannot read credential fields. This query is read-only and returns only a claim classification and booleans, never emails, IDs or password hashes.

- `unclaimed` means no owner claim has completed. Two null UUIDs do **not** count as a verified enrollment.
- `reserved-enrollment` means the consumed claim matches a non-null reserved UUID. It identifies the setup path, not whether current credentials are uncompromised. Verify current membership and account access separately.
- `owner-review` means the claim predates reserved enrollment or came through a dashboard membership. Follow the previously claimed store procedure if its origin cannot be established. A missing owner account (`owner_account_present=false`) also requires recovery. No rows means setup state is missing; check migrations before proceeding.
- For `owner-review`, `owner_has_password=true` warrants investigation: the older invitation flow created new accounts without a password, but could adopt a previously registered account that retained one. A password is expected for the new Admin API flow because Supabase generates a random one; this flag alone does not establish compromise. `false` is not proof of safety either. In particular, `invited_at` cannot clear an older claim: Supabase can re-invite an existing unconfirmed registration without removing its credentials.

## Setup diagnostics

Setup messages name the appropriate recovery action after the owner proves the setup key. Logs contain fixed codes only; do not paste raw provider errors, emails, setup proofs, UUIDs or credentials into reports.

| Code                               | Next action                                                                                        |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| `ADMIN_OWNER_UNCONFIGURED`         | Check the matching Auth project and server-only provisioning configuration.                        |
| `ADMIN_OWNER_PROVIDER_CREDENTIALS` | Correct the rejected or revoked server-only credential and project.                                |
| `ADMIN_OWNER_PROVIDER_UNAVAILABLE` | Check provider/network availability or rate limits; retry the same setup.                          |
| `ADMIN_OWNER_ACCOUNT_CONFLICT`     | Stop and review the unexpected existing account in Authentication → Users.                         |
| `ADMIN_OWNER_ACCOUNT_MISMATCH`     | Review the reserved account's identity, confirmation and ban status.                               |
| `ADMIN_OWNER_SETUP_CHANGED`        | Setup was consumed or changed concurrently; request a current code or use normal sign-in/recovery. |
| `ADMIN_OWNER_EMAIL_DELIVERY`       | Check SMTP, provider settings and magic-link template, then request another code.                  |
| `ADMIN_OWNER_MIGRATION_REQUIRED`   | Disable setup, apply missing migrations and deploy matching code.                                  |

The setup page checks the enrollment columns before showing its form. Page/database failures use `ADMIN_SETUP_STATUS_UNAVAILABLE` or `ADMIN_AUTH_ACTION_FAILED` with a coarse cause, such as `missing-relation`, `permission-denied` or `connection-failure`; no raw error details are logged.

## Request and session protections

The deployed app trusts only Vercel's platform-supplied [`x-vercel-forwarded-for`](https://vercel.com/docs/headers/request-headers) when the server's `VERCEL=1`. It validates a single IP address and ignores caller-supplied `X-Forwarded-For`, `X-Real-IP`, and `Host` for throttling. Another hosting platform needs an explicitly trusted source adapter before email/setup actions are enabled; do not copy forwarded headers into a trusted bucket.

App limits use 15-minute windows: five sends per source, five setup attempts per source (including wrong setup proofs), and twenty verification attempts per source with five per source/email pair. These are not global email lockouts: someone guessing a known owner's address from another source cannot exhaust the owner's app bucket. [Supabase's own provider limits](https://supabase.com/docs/guides/auth/rate-limits) still apply. Shared networks share a source bucket. Only hashed bucket keys are stored; indexed cleanup removes at most 100 expired rows older than a day per attempt, without serializing other attempts behind cleanup.

All three Supabase clients set `Secure` cookies by default. Ordinary `next dev` without `NEXT_PUBLIC_SITE_URL` uses a local development bucket and HTTP-compatible cookies. For production-mode local tests, explicitly set `NEXT_PUBLIC_SITE_URL` to an HTTP loopback origin (`localhost`, `127.0.0.1`, or `[::1]`); both client and server must use the same build configuration. A non-loopback site always keeps Secure cookies, including development builds. Successful sign-in lands on `/admin/account`. Failed owner claims clear the newly created local Auth session when no active membership exists.

## Add, remove, or recover an administrator

Invite the person through Supabase **Authentication → Users** and let them finish email verification. Copy their Auth user UUID. In **Table Editor → `public.admin_memberships`**, insert a row with that `user_id` and `active=true`. The app does not use editable user metadata as an admin flag.

Set `active=false` to revoke library access. Every protected request looks up current membership, so an old session cannot keep browsing through an outdated role claim. Personal favorites remain attached to the user and are available if membership is later restored.

If the last admin is removed after setup, the app shows recovery instructions. Restore a verified user's membership through the Supabase dashboard. Do not clear the consumed setup state as a routine recovery shortcut. Forgotten or unavailable passkeys can use email verification; a lost email account needs an owner-controlled provider recovery process.

## Verify before rollout

Use an isolated local Supabase environment for real Auth checks and isolated `store_admin_test` Postgres for the automated claim, role, race, and RLS tests. CI runs the browser suite with public signup both disabled (the production default) and enabled, checking rejection of pre-existing confirmed/unconfirmed registrations, mailbox verification, and protection during provisioning. The claim database tests connect as `store_app_runtime`, the same restricted login production uses, so they also verify its grants and policies. Never point test variables at production. `ADMIN_TEST_DATABASE_URL` makes those database tests run in `pnpm test:unit`; CI provisions its own test database.

Verify setup, passkey enrollment and sign-in, email recovery, normal-user denial, admin removal, and private download denial in the intended browser and environment. A build or fixture-backed UI test does not establish that a physical passkey or production SMTP works. Passkeys on the owner's device and production email/configuration are rollout checks, not claims implied by the test suite.

Admin routes return private/no-store headers and noindex metadata. Private pages are excluded from storefront pageviews, attribution, and conversion events, including navigation from a shop page where the analytics SDK was already loaded. Gallery assets must be served by the protected application route rather than the public image optimizer.

See the [design-library guide](admin-design-library.md) for design identity, personal selections, generation and product-draft boundaries.
