# Design-drop signup and removal requests

`storeConfig.features.dropSignup` controls the optional email signup. The form also requires `configured` and `policies.published`. Set the store's real `supportEmail`, review the privacy disclosure, and arrange a monitored support inbox before enabling it. A checkbox in configuration does not hire an inbox attendant.

New signups require inbox confirmation before becoming eligible for drop emails. Confirmation sending and [weekly drop emails](drop-emails.md) have separate default-off switches. Once enabled, the weekly sender announces each Design of the Week once, with an unsubscribe link and one-click unsubscribe headers in every message. The form also offers a monitored support contact; opening that email link does not change the database. Other campaign providers require their own separately reviewed integration.

## What is recorded

The server saves a normalized email address, signup surface, consent wording version, consent time, creation/update times, and a trusted hosting-platform IP address when available. It also stores current and previous unsubscribe times; `confirmed_at` records explicit inbox confirmation for new consent. Historical rows remain legacy with their original evidence. With drop emails enabled, it records which drop emails were addressed to each subscriber and what happened to each send, without copying the address. A separate hashed request bucket limits abuse. See the source-owned Privacy page disclosures for checkout, browser storage, first-party order attribution, and optional provider measurement.

`drop-consent-copy.ts` contains the exact consent text; v1 and v2 remain unchanged in `drop-consent-wording.ts`; v3 adds inbox confirmation and describes email-based removal. Bump the version when this promise changes. The same wording appears on the Privacy page. Keep approved owner privacy text in `storeConfig.policies.privacyText` alongside these runtime disclosures, and review the whole page before publishing. Do not add unsupported retention schedules, provider guarantees, or claims of anonymous data.

## Process a removal request

Use the store's existing authorized database workflow and verified TLS connection; do not put credentials or customer addresses in chat, committed files, command-line arguments, or logs. The support mailbox should receive requests from the subscribed address. Do not disclose whether unrelated addresses are on the list. If the sender cannot use that address, handle the request privately through the owner's support process.

From the repository root, run the checked-in [removal prompt](../scripts/database/remove-drop-subscriber.psql) with the store's verified **runtime** database connection. Replace only the non-secret connection placeholders below; `--password` prompts privately for the password, and the script separately prompts for the subscriber address:

```sh
psql -X --no-readline --password 'host=POOLER_HOST port=5432 dbname=postgres user=RUNTIME_USER sslmode=verify-full sslrootcert=PROVIDER_CA_FILE' --file scripts/database/remove-drop-subscriber.psql
```

Use the actual direct-connection or session-pooler runtime username from [store setup](store-setup.md#provision-the-runtime-login). Do not use the migration-owner credential for this operation. Enter the address only at `Subscriber address to remove:`. The input is visible in your private terminal, so avoid terminal recording. `--no-readline` disables psql history, `-X` bypasses local psql startup customizations, and the file disables SQL echo and stops on SQL errors. It prints only an outcome, never the address, IP, or subscriber record. This does not override the database service's audit-log settings; handle any such logs under the owner's existing data-access process.

The file uses [psql's quoted-variable syntax](https://www.postgresql.org/docs/current/app-psql.html#APP-PSQL-INTERPOLATION) to pass the prompt value as an SQL literal, normalizes space padding and case with `lower(btrim(...))`, and updates only the matching row. It preserves an existing removal timestamp, reads the suppression state back under the row lock, and reports **Removal verified** only after the transaction commits. The integration test runs this exact file, including its prompt, with the restricted runtime role.

**No matching subscriber** is not an error to "fix" by inserting a subscriber. If psql exits with an error or the connection result is uncertain, keep the request pending and retry the same address; do not send a success response or a campaign to that address meanwhile. A repeated successful removal keeps the original removal timestamp. Retain minimal support evidence under the owner's reviewed policy without copying signup IPs or full subscriber records.

If the owner maintains any external campaign list or pending send, suppress the address there as well and stop queued delivery before marking the request complete. Before **every** send, apply pending support requests, read the current eligible rows with `where commerce.is_drop_subscriber_eligible(drop_subscribers)`, and apply the sending service's suppression list. Never reuse a stale export. The built-in drop email sender re-reads each subscriber's current state before every message, so a recorded removal stops it; it cannot apply a support request nobody has processed yet. Nothing enforces these steps for an external sender.

Submitting the form requests fresh inbox proof. New addresses are pending; unsubscribed addresses stay suppressed until an explicit confirmation POST. Historical rows remain legacy without fabricated timestamps. The shared SQL eligibility function controls duplicate requests, aggregate counts, weekly snapshots and every send claim. Confirmed eligibility starts at confirmation time; legacy cutoffs retain their existing behavior. A duplicate request from an eligible address changes nothing and sends no confirmation.

When closing a list that has collected addresses, set `privacy.retainedDropSubscribers=true` before setting `features.dropSignup=false`. This closes new collection and keeps the Privacy page’s removal contact available for existing subscribers. A store that has never collected addresses leaves both flags false and does not publish a signup-data disclosure. Neither flag deletes subscriber records, processes pending removals, or stops an external sender. A closed list with retained subscribers still receives [drop emails](drop-emails.md) while they are enabled; set `DROP_EMAILS_ENABLED=false` and redeploy to stop them. Keep the retained-data flag true until the owner’s actual retention process makes that disclosure unnecessary.

## Export and retention boundaries

Apart from the optional drop emails, there is no campaign sender or export screen in this template. If an owner authorizes a manual transfer to a separately configured sender, use the verified server-side database workflow and select only the fields that sender needs from current rows where `commerce.is_drop_subscriber_eligible(drop_subscribers)`. Check pending support removals immediately before the transfer, preserve consent evidence, and apply the destination’s existing suppression list. Do not copy signup IPs into a mailing list or treat an old export as current consent. The destination must provide and verify its own sending and unsubscribe behavior.

Never-confirmed pending signups expire automatically after their latest 24-hour confirmation request expires. The authenticated production signup-confirmations worker performs bounded cleanup even when sending is disabled. Cleanup requires the authenticated production deployment and database; it continues if store, policy or list presentation flags are closed. Sending and support reads retain their stricter readiness gates. Configure the example 15-minute schedule; code alone does not activate a remote cron. Confirmed, historical and unsubscribed records are retained until reviewed admin erasure. Unsubscribe suppresses eligibility without erasing records. See [subscriber controls](subscriber-admin.md) for erasure scope and external-copy limits.

## Verify before enabling

Use synthetic addresses and an isolated test database to check signup, duplicate signup, removal, repeat removal, an unknown address, and re-signup. Verify the configured `mailto:` destination on the form and Privacy page with keyboard access on a narrow screen. Confirm the owner can receive and handle a test support request before advertising the list. A database row alone proves neither email delivery nor campaign suppression.

The signup database integration suite runs the checked-in removal prompt and requires a PostgreSQL `psql` client on `PATH`. An isolated local container can supply it through `PSQL_BIN`, the path to a wrapper that runs that container's client. If a test database is configured but the client is missing, the test fails instead of silently skipping the operator workflow.

## Inbox confirmation and release

`SIGNUP_CONFIRMATIONS_ENABLED` defaults false and is separate from `DROP_EMAILS_ENABLED`. Sending requires production, configured identity, reviewed policies, a disclosed open or retained list, the store's HTTPS origin, database and verified Resend sender. New signup requests also require `features.dropSignup`. Confirmation itself remains available for existing links when only sending is paused; previews never send or consume production links. The shirt can be a surprise; enrollment cannot.

Links carry a random capability in `/confirm-signup#<token>`. The page removes the fragment and keeps it in memory; GET does nothing. An explicit same-origin POST consumes it. Reloading asks the visitor to reopen the original email. Keep Resend open/click tracking and link rewriting off. This page and unsubscribe pages never load measurement. Links expire after 24 hours; resends wait 15 minutes and are limited to three per address per rolling day. A new link revokes the prior unused link. Repeated unsubscribe also revokes outstanding links.

Queueing commits before acknowledgment, then Next.js `after()` attempts prompt delivery. The authenticated confirmation worker retries frozen single-recipient payloads under the original provider idempotency key for less than 23 hours, rather than risk a second email after the provider's deduplication window. Provider acceptance is not inbox receipt. Include the 15-minute worker from `scripts/vercel-crons.example.json` in the separately reviewed host schedule; `vercel.json` deliberately activates no workers.

For an existing store, stop both senders and drain in-flight workers before applying the incremental confirmation migration. Its database guards prevent old v1/v2 forms from granting consent and old weekly workers from claiming pending or too-late confirmed recipients. Preserve old migration bytes and forward-port receipts. Rollback keeps sending disabled and retains the new schema; do not remove consent columns or restore a database over newer payment receipts.

Before activation, record the deployed SHA and actual schema version, verify cron authorization, then use an owner-controlled inbox to prove receipt, pending on GET, explicit POST confirmation, cutoff eligibility, unsubscribe/re-signup suppression, expiry and replay rejection. Record a normal scheduled drop's suppression evidence separately. The source port is prepared under the owner's October 1 instruction; live source-store confirmation/admin/scheduled-suppression proof remains a release-readiness follow-up. No historical confirmation conversion is included.

Signup admission has a store-wide rolling-hour ceiling of 20 by default, configurable with `SIGNUP_CONFIRMATIONS_HOURLY_LIMIT` (1–1000). A locked budget row charges **every admitted request before any email lookup**, including eligible addresses and resend cooldowns that queue no mail. One trusted request identity can use at most `max(1, floor(limit / 4))` slots per hour (five at the default). The existing 15-minute request limiter remains separate. The server passes its trusted IPv4 or IPv6 /64 subject, never the caller's email, into admission.

The budget retains at most 1000 paired timestamps and SHA-256 identity hashes. They expire together after an hour and survive subscriber erasure and automatic pending expiry. Hashes are pseudonymous abuse evidence, not anonymous data; no recipient address is retained there. A full store returns HTTP 503 with an hour retry instruction; an identity limit returns 429. Neither rejection creates a pending subscriber, revokes an existing link or alters suppression. Admission responses depend on capacity, never membership. Eligible addresses and cooldowns still return the same accepted response after admission. This bounds application abuse, not a distributed flood.

The worker reports `busy` for lock contention and `saturated` for recent admission saturation, separately from delivery `errors`. Healthy cron runs return 200 even when busy or saturated; provider/storage and housekeeping failures retain 503. Queued requests remain durable. Prompt sends wait up to five seconds for the shared worker lock, releasing the pool connection between retries; cron handles a bounded deferral. The private admin page displays aggregate admitted requests and recent saturation, without recipient or identity details. It never claims excess requests are queued or automatically reopens signup.

### Admission migration cutover

For a populated template store, disable **both** senders, drain in-flight workers, and apply `20261002210616_signup_confirmation_admission.sql` before deploying the new writer. Keep any authenticated expiry schedule running. This forward migration preserves the existing budget's recent timestamps and saturation marker, adds null hashes for unknown historical identities, and seeds recent confirmation receipts only if a budget row is absent. Existing runtime grants and RLS remain intact. A budget larger than 1000 fails the migration for review; never clear it to pass a check.

Compare aggregate capacity before and after the migration, then verify the receiving shape and unchanged role boundary without exposing hashes or recipients:

```sql
-- Before cutover:
select cardinality(queued_at) as prior_slots,
  (select count(*) from unnest(queued_at) stamp where stamp > now() - interval '1 hour') as recent_slots
from commerce.drop_signup_confirmation_budget;
-- After cutover:
select cardinality(accepted_at) as retained_slots,
  cardinality(accepted_at) = cardinality(subject_hashes) as paired,
  cardinality(accepted_at) <= 1000 as bounded
from commerce.drop_signup_confirmation_budget;
select has_table_privilege('store_app_runtime', 'commerce.drop_signup_confirmation_budget', 'SELECT,INSERT,UPDATE') as runtime_access,
  has_table_privilege('anon', 'commerce.drop_signup_confirmation_budget', 'SELECT') as anon_access,
  has_table_privilege('authenticated', 'commerce.drop_signup_confirmation_budget', 'SELECT') as browser_access;
```

`retained_slots` must match the previously recent slots (allowing only elapsed expiry), `paired`, `bounded` and `runtime_access` must be true, and both browser fields false. Verify runtime admission works and historical consent/suppression is unchanged. PostgreSQL applies this statement batch atomically; a failed migration can be retried unchanged. Old application writers use the removed `queued_at` column and fail closed. Rollback keeps sending disabled and retains the forward schema; use a forward fix rather than restoring an old app or database over newer receipts. Re-enable sending only under the owner's existing activation authority after the deployed SHA, schema and actual inbox/suppression proof are recorded.

When optional signup is selected but sending is paused, the home page explains the pause without rendering a form. Expired confirmation recovery points to the latest email and configured support contact rather than a hidden signup form. Valid email capabilities still require explicit POST and may confirm while new collection is paused.

Unsubscribe reversals without a newly consumed confirmation fail with `Fresh subscriber confirmation required`, including direct owner SQL. Resubmission alone cannot undo a stop.
