# Subscriber support controls

Products → Drop emails provides an exact-email lookup and shared unsubscribe. This is a targeted support tool, not a browsing list, export, or campaign manager. Addresses and subscriber UUIDs use bounded POST bodies with private no-store/no-index/no-referrer responses. Every operation rechecks the current user and active admin membership, same origin, configured policies, and the open or retained-list disclosure. No commands or grants are added to design agents. The admin page loads no measurement tags. The support inbox gets a desk; the mailing list gets no megaphone.

Consent evidence expands to show timestamps, source, signup IP when available, and the exact immutable v1/v2/v3 wording. Pending consent never looks confirmed. Unknown versions report unavailable wording rather than inventing a promise. The explicit database projection excludes confirmation tokens, frozen messages, and provider identifiers.

Unsubscribe uses the same store as email links, preserves the first stop time, and revokes outstanding links even on repeated stops. It prevents new send claims; an email already handed to the provider cannot be recalled. For lost or unreadable responses, look up the original subscriber again before retrying. This does not alter checkout, order, payment, or fulfillment data. Support email and external sender copies need their own reviewed retention/suppression processes.

## Verification and release

The confirmation layer and its migration must precede this support layer. Keep sending disabled during cutover and preserve the separate migration/production authority. Verify owner login, exact lookup for owner-controlled records, immutable historical wording, admin unsubscribe and repeated-stop/re-signup suppression. Record the deployed SHA, schema, and actual outcomes. Fixture tests prove local behavior, not real inbox receipt or production access. Live source-store proof remains a release-readiness follow-up before adopting the completed bundle into a release.

`SUBSCRIBER_TEST_DATABASE_URL` must name isolated local `store_subscriber_test`. Foundation provisions it and refuses missing configuration in CI. Restricted runtime integration and real local Supabase admin browser journeys cover current membership, same-origin denial, private projections and keyboard/narrow-width behavior.

Unsubscribe requires a second confirmation showing the exact address. Cancel keeps the subscriber untouched and returns focus to the action. A completed stop cannot be undone by an administrator or direct SQL; the subscriber must sign up again and explicitly confirm a fresh inbox link. Existing consent/stop evidence remains recorded, but an accidental stop still interrupts delivery. Only confirm it for the subscriber’s requested removal.
