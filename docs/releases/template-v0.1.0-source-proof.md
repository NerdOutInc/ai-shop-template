# Source-store subscriber production evidence

This receipt records production checks for the ledger's `original-store` source. It is partial release-readiness evidence, not receiving-store activation. The `source-store-live-proof` publication blocker remains open until the outstanding checks below have actual results. Private inbox addresses, subscriber identifiers, provider receipts and deployment configuration stay outside the reusable template.

## Verified October 3, 2026 (Central)

The deployed source code is `2926c59ca5823b3894b3404c05a5cadbd2d60b70`. The source's canonical safety migration (version `20261002150918`, name `signup_confirmation_safety`) was missing in production: confirmation cron returned HTTP 503 and private admission health was unavailable. Both existing senders were paused in a ready production deployment, workers were drained, and the exact source migration was applied before restoring the same code with the prior sender settings. Its receipt uses the canonical source version. This is a source-specific migration repair; it neither applies a template baseline nor ports the template's different forward migrations.

Post-repair reads verified bounded, paired budget timestamps, application access and browser-role denial. The private owner page displays aggregate admission health, both existing senders restored, and the scheduled confirmation worker returned HTTP 200. Provider acceptance was followed by actual owner inbox receipt; it was not treated as delivery proof by itself.

| Check                  | Actual production outcome                                                                                                                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner support access   | Authenticated owner opened the private email page and looked up the exact controlled test address.                                                                                                                           |
| Scanner-safe opening   | Opening the emailed confirmation link left the request pending, unconsumed and ineligible.                                                                                                                                   |
| Explicit confirmation  | Owner pressed Confirm and reported “YOU'RE ON THE LIST”; the saved confirmation time matches the consumed request, basis `email-link`, and eligibility became true.                                                          |
| Consent evidence       | Source confirmation retains its immutable v2 wording. The template continues to use v3 for new requests; source wording and historical conversions are not inherited.                                                        |
| Admin unsubscribe      | Owner's designated test record became ineligible and its open links were revoked. The original three subscribers were left untouched.                                                                                        |
| Re-signup after a stop | A new public signup sent a fresh confirmation email while preserving the original stop and ineligibility. Signup alone did not resume delivery.                                                                              |
| Repeated stop          | The private support control preserved the first stop, revoked the new link and removed its frozen confirmation message.                                                                                                      |
| Revoked-link rejection | Owner pressed Confirm in that newest, revoked email and reported “THIS LINK HAS EXPIRED”. A fresh database read still showed the original stop and ineligibility. This proves revocation rejection, not elapsed-time expiry. |
| Cutoff eligibility     | A read using the production eligibility predicate and the October 5 reveal cutoff returned false for the stopped test record. This is not a completed scheduled-send observation.                                            |

## Outstanding live checks

- Fresh explicit reconfirmation after a stop, including retained stop-history evidence, followed by another requested stop so the controlled record remains available for the suppression check. Respect the production resend cooldown and daily request cap.
- Replayed consumed-link rejection and elapsed-time expiry/cleanup evidence. Do not change production clocks or manufacture old timestamps to count a synthetic check as live proof.
- A normal scheduled production drop excluding the stopped owner-controlled test record. At the last observation there were no normal drop receipts; the next configured drop is October 5 at 9 AM Central. Do not force a customer campaign to test this gate.
- Reviewed erasure of an owner-approved test record, followed by original-identity/owned-row readback and verification that unrelated orders and shared templates remain. Preserve the stopped record until scheduled suppression evidence has been captured, and obtain the owner's concrete approval before irreversible erasure.

The exact provider/deployment and test-record receipts are held privately. Local fixtures and hosted template CI remain separate evidence for the reusable code. Final publication also requires review of the completed receipt, an accurate PR inventory, regeneration at the final merged template SHA and that SHA's successful full Check run.
