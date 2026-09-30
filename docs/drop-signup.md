# Design-drop signup and removal requests

`storeConfig.features.dropSignup` controls the optional email signup. The form also requires `configured` and `policies.published`. Set the store's real `supportEmail`, review the privacy disclosure, and arrange a monitored support inbox before enabling it. A checkbox in configuration does not hire an inbox attendant.

The template collects addresses. It does **not** send campaigns, issue confirmation emails or verify inbox ownership. Its one optional sender, [drop emails](drop-emails.md), is off by default: once enabled, it announces each Design of the Week to the list, and every message carries its own unsubscribe link and one-click unsubscribe headers. Without it, nothing is sent and there are no automatic unsubscribe links. Either way, the form explicitly offers an email request to support for removal. Opening that link does not change the database. Do not promise instant or self-service unsubscribe from the form itself. If the store needs any other sending provider, implement and test that separate integration before promising it.

## What is recorded

The server saves a normalized email address, signup surface, consent wording version, consent time, creation/update times, and a trusted hosting-platform IP address when available. It also stores current and previous unsubscribe times; `confirmed_at` exists but this template does not confirm inbox ownership. With drop emails enabled, it records which drop emails were addressed to each subscriber and what happened to each send, without copying the address. A separate hashed request bucket limits abuse. See the source-owned Privacy page disclosures for checkout, browser storage, first-party order attribution, and optional provider measurement.

`drop-consent-copy.ts` contains the exact consent text; v2 explicitly describes email-based removal. Bump the version when this promise changes. The same wording appears on the Privacy page. Keep approved owner privacy text in `storeConfig.policies.privacyText` alongside these runtime disclosures, and review the whole page before publishing. Do not add unsupported retention schedules, provider guarantees, or claims of anonymous data.

## Process a removal request

Use the store's existing authorized database workflow and verified TLS connection; do not put credentials or customer addresses in chat, committed files, command-line arguments, or logs. The support mailbox should receive requests from the subscribed address. Do not disclose whether unrelated addresses are on the list. If the sender cannot use that address, handle the request privately through the owner's support process.

From the repository root, run the checked-in [removal prompt](../scripts/database/remove-drop-subscriber.psql) with the store's verified **runtime** database connection. Replace only the non-secret connection placeholders below; `--password` prompts privately for the password, and the script separately prompts for the subscriber address:

```sh
psql -X --no-readline --password 'host=POOLER_HOST port=5432 dbname=postgres user=RUNTIME_USER sslmode=verify-full sslrootcert=PROVIDER_CA_FILE' --file scripts/database/remove-drop-subscriber.psql
```

Use the actual direct-connection or session-pooler runtime username from [store setup](store-setup.md#provision-the-runtime-login). Do not use the migration-owner credential for this operation. Enter the address only at `Subscriber address to remove:`. The input is visible in your private terminal, so avoid terminal recording. `--no-readline` disables psql history, `-X` bypasses local psql startup customizations, and the file disables SQL echo and stops on SQL errors. It prints only an outcome, never the address, IP, or subscriber record. This does not override the database service's audit-log settings; handle any such logs under the owner's existing data-access process.

The file uses [psql's quoted-variable syntax](https://www.postgresql.org/docs/current/app-psql.html#APP-PSQL-INTERPOLATION) to pass the prompt value as an SQL literal, normalizes space padding and case with `lower(btrim(...))`, and updates only the matching row. It preserves an existing removal timestamp, reads the suppression state back under the row lock, and reports **Removal verified** only after the transaction commits. The integration test runs this exact file, including its prompt, with the restricted runtime role.

**No matching subscriber** is not an error to "fix" by inserting a subscriber. If psql exits with an error or the connection result is uncertain, keep the request pending and retry the same address; do not send a success response or a campaign to that address meanwhile. A repeated successful removal keeps the original removal timestamp. Retain minimal support evidence under the owner's reviewed policy without copying signup IPs or full subscriber records.

If the owner maintains any external campaign list or pending send, suppress the address there as well and stop queued delivery before marking the request complete. Before **every** send, apply pending support requests, read the current eligible rows with `where unsubscribed_at is null`, and apply the sending service's suppression list. Never reuse a stale export. The built-in drop email sender re-reads each subscriber's current state before every message, so a recorded removal stops it; it cannot apply a support request nobody has processed yet. Nothing enforces these steps for an external sender.

Submitting the public signup again refreshes consent and clears `unsubscribed_at`, preserving the previous timestamp in `last_unsubscribed_at`. Because the template has no email verification, a new form submission is not proof of inbox ownership. Do not let an import or that submission automatically override a removal recorded in an external sender; use the owner's verified re-consent process there.

When closing a list that has collected addresses, set `privacy.retainedDropSubscribers=true` before setting `features.dropSignup=false`. This closes new collection and keeps the Privacy page’s removal contact available for existing subscribers. A store that has never collected addresses leaves both flags false and does not publish a signup-data disclosure. Neither flag deletes subscriber records, processes pending removals, or stops an external sender. A closed list with retained subscribers still receives [drop emails](drop-emails.md) while they are enabled; set `DROP_EMAILS_ENABLED=false` to stop them. Keep the retained-data flag true until the owner’s actual retention process makes that disclosure unnecessary.

## Export and retention boundaries

Apart from the optional drop emails, there is no campaign sender or export screen in this template. If an owner authorizes a manual transfer to a separately configured sender, use the verified server-side database workflow and select only the fields that sender needs from current rows where `unsubscribed_at is null`. Check pending support removals immediately before the transfer, preserve consent evidence, and apply the destination’s existing suppression list. Do not copy signup IPs into a mailing list or treat an old export as current consent. The destination must provide and verify its own sending and unsubscribe behavior.

The database has no automatic subscriber-retention or erasure job. An unsubscribe timestamp suppresses eligibility; it does not delete the email, signup IP or consent history. The owner must decide and implement any retention or erasure process, review external copies, and make the published privacy text match that process. This template does not choose a retention period or promise that removing someone from mail also erases all records.

## Verify before enabling

Use synthetic addresses and an isolated test database to check signup, duplicate signup, removal, repeat removal, an unknown address, and re-signup. Verify the configured `mailto:` destination on the form and Privacy page with keyboard access on a narrow screen. Confirm the owner can receive and handle a test support request before advertising the list. A database row alone proves neither email delivery nor campaign suppression.

The signup database integration suite runs the checked-in removal prompt and requires a PostgreSQL `psql` client on `PATH`. An isolated local container can supply it through `PSQL_BIN`, the path to a wrapper that runs that container's client. If a test database is configured but the client is missing, the test fails instead of silently skipping the operator workflow.
