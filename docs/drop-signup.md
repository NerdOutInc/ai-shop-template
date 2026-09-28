# Design-drop signup and removal requests

`storeConfig.features.dropSignup` controls the optional email signup. The form also requires `configured` and `policies.published`. Set the store's real `supportEmail`, review the privacy disclosure, and arrange a monitored support inbox before enabling it. A checkbox in configuration does not hire an inbox attendant.

The template collects addresses; it does **not** send campaigns, issue confirmation emails, verify inbox ownership, or provide automatic unsubscribe links. The form explicitly offers an email request to support for removal. Opening that link does not change the database. Do not promise instant or self-service unsubscribe. If the store needs a sending provider or a verified unsubscribe-token workflow, implement and test that separate integration before promising it.

## What is recorded

The server saves a normalized email address, signup surface, consent wording version, consent time, creation/update times, and a trusted hosting-platform IP address when available. It also stores current and previous unsubscribe times; `confirmed_at` exists but this template does not confirm inbox ownership. A separate hashed request bucket limits abuse. See the source-owned Privacy page disclosures for checkout, browser storage, first-party order attribution, and optional provider measurement.

`drop-consent-copy.ts` contains the exact consent text; v2 explicitly describes email-based removal. Bump the version when this promise changes. The same wording appears on the Privacy page. Keep approved owner privacy text in `storeConfig.policies.privacyText` alongside these runtime disclosures, and review the whole page before publishing. Do not add unsupported retention schedules, provider guarantees, or claims of anonymous data.

## Process a removal request

Use the store's existing authorized database workflow and verified TLS connection; do not put credentials or customer addresses in chat, committed files, command-line arguments, or logs. The support mailbox should receive requests from the subscribed address. Do not disclose whether unrelated addresses are on the list. If the sender cannot use that address, handle the request privately through the owner's support process.

Apply this [parameterized node-postgres query](https://node-postgres.com/features/queries) with an existing, authorized server-side `pool` and the requested address supplied as the `requestedEmail` variable. It uses the same trim/lowercase normalization as signup, preserves an existing removal timestamp, and changes only the matching row:

```ts
const email = requestedEmail.trim().toLowerCase()
const result = await pool.query(
  `update commerce.drop_subscribers
   set unsubscribed_at = coalesce(unsubscribed_at, now()), updated_at = now()
   where email = $1
   returning unsubscribed_at`,
  [email]
)
const removed = result.rowCount === 1 && result.rows[0].unsubscribed_at !== null
const verification = await pool.query("select unsubscribed_at from commerce.drop_subscribers where email = $1", [email])
const verified = removed && verification.rowCount === 1 && verification.rows[0].unsubscribed_at !== null
```

Read back the timestamp with another parameterized query before marking the request handled. Zero rows is not an error to "fix" by inserting a subscriber. If the database operation fails or its result is uncertain, keep the request pending and retry the same address; do not send a success response or a campaign to that address meanwhile. Retain the minimal support evidence under the owner's reviewed policy without copying signup IPs or full subscriber records.

If the owner maintains any external campaign list or pending send, suppress the address there as well and stop queued delivery before marking the request complete. Before **every** send, apply pending support requests, read the current eligible rows with `where unsubscribed_at is null`, and apply the sending service's suppression list. Never reuse a stale export. This template provides no sender or queue that enforces these operational steps automatically.

Submitting the public signup again refreshes consent and clears `unsubscribed_at`, preserving the previous timestamp in `last_unsubscribed_at`. Because the template has no email verification, a new form submission is not proof of inbox ownership. Do not let an import or that submission automatically override a removal recorded in an external sender; use the owner's verified re-consent process there.

Turning signup off closes new collection and leaves existing subscriber data untouched. The Privacy page keeps the removal contact available for configured stores even while signup is disabled. Disabling the feature does not process pending removal requests or stop an external sender.

## Export and retention boundaries

There is no campaign sender or export screen in this template. If an owner authorizes a manual transfer to a separately configured sender, use the verified server-side database workflow and select only the fields that sender needs from current rows where `unsubscribed_at is null`. Check pending support removals immediately before the transfer, preserve consent evidence, and apply the destination’s existing suppression list. Do not copy signup IPs into a mailing list or treat an old export as current consent. The destination must provide and verify its own sending and unsubscribe behavior.

The database has no automatic subscriber-retention or erasure job. An unsubscribe timestamp suppresses eligibility; it does not delete the email, signup IP or consent history. The owner must decide and implement any retention or erasure process, review external copies, and make the published privacy text match that process. This template does not choose a retention period or promise that removing someone from mail also erases all records.

## Verify before enabling

Use synthetic addresses and an isolated test database to check signup, duplicate signup, removal, repeat removal, an unknown address, and re-signup. Verify the configured `mailto:` destination on the form and Privacy page with keyboard access on a narrow screen. Confirm the owner can receive and handle a test support request before advertising the list. A database row alone proves neither email delivery nor campaign suppression.
