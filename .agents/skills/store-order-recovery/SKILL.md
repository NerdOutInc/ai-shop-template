---
name: store-order-recovery
description: Investigate paid Stripe orders that are pending, failed, duplicated, or uncertain at Printify, and prepare or perform explicitly authorized recovery without duplicate production.
---

# Recover a paid order

Reconcile payment, the durable application record, and Printify before taking action. The printer does not need a double-click.

Read [fulfillment recovery](../../../docs/store-setup.md#operations-and-recovery), [fulfillment logic](../../../src/features/checkout/fulfill-checkout.server.ts), [provider reconciliation](../../../src/features/checkout/read-printify-order.server.ts), and [the order store](../../../src/features/checkout/postgres-order-store.server.ts). For payment disagreement, also read [paid-session verification](../../../src/features/checkout/verify-paid-session.server.ts). Refresh relevant [Stripe webhook behavior](https://docs.stripe.com/webhooks) and [Printify order documentation](https://developers.printify.com/) before relying on provider semantics.

## Build the evidence first

Resolve the exact Stripe account/mode, Checkout Session ID, saved checkout request, Printify shop, and any provider order ID. Read the private database's state/failure code, Stripe's current payment and delivery evidence, and the matching provider order. Use minimal fields; compare addresses privately without copying them into logs, journal entries, or reports.

Payment success, webhook delivery, order creation, and production submission are separate facts. A customer return page or a 200 webhook response alone is insufficient. The handler acknowledges unrelated events too. Verify the stored record belongs to this session/shop and inspect the actual product IDs, variants, quantities, and captured destination.

Record whether the result is confirmed, absent in a complete search, or unconfirmed because a search/read failed. The existing recovery code bounds inventory search; exhausting that bound does not prove an order is absent.

## Follow the saved state

The application commits `creating` before a provider create call and `submitting` before a production call. Session-scoped Postgres locks exclude concurrent work. Creation sends `external_id=session.id`; current provider readback matches `metadata.shop_order_id` to that Session ID. Use the supported read/pagination path rather than inventing a search filter. Preserve these claims: rolling a phase back after a timeout could print a second order.

Follow the durable phase even when the failure code is generic: a first create transport timeout can report `PRINTIFY_UNAVAILABLE` while the record remains `creating`. It still requires reconciliation before any retry; do not wait for the more specific `ORDER_CREATE_UNCERTAIN` code to protect against duplication.

| State or evidence                                                           | Recovery decision                                                                                                                                            |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `simulated`                                                                 | This was test-mode fulfillment. Do not convert it into a real Printify order.                                                                                |
| Unpaid or failed delayed payment                                            | Confirm current Stripe status; no production action is appropriate.                                                                                          |
| `pending` with payment confirmed                                            | Identify the fixed failure code and failed prerequisite before replaying anything.                                                                           |
| `creating` / `ORDER_CREATE_UNCERTAIN`                                       | Read the known order ID or search by the Session identity. Compare contents and destination. A lost response does not authorize a second create.             |
| `created` / `PROVIDER_PROCESSING`                                           | Read the provider state. Pending/cost calculation is processing, not confirmation of production.                                                             |
| `submitting` / `PRODUCTION_UNCERTAIN`                                       | Read the existing order. Recognize confirmed production without submitting again. An on-hold result after an uncertain submission still needs investigation. |
| Provider already sending to production, in production, or fulfilled         | Use the existing order; reconcile the application state through its supported flow.                                                                          |
| `PRODUCT_CHANGED`                                                           | Compare saved production fingerprints and availability with current variants. Do not overwrite snapshots or relax comparison to make fulfillment pass.       |
| Address/item mismatch, duplicate provider orders, incomplete reconciliation | Stop dependent mutations and present the specific conflict for merchant review.                                                                              |
| `ORDER_IDENTITY_MISSING` on an unfinished order                             | The snapshot lacks `commerceIdentity`. Stop automatic recovery and follow the identity checks below; there is no supported backfill.                         |
| `PAYMENT_MISMATCH` with differing payment identities                        | Session `metadata.storefront` differs from saved `order.commerceIdentity`. Reconcile identity before investigating amounts or refunds.                       |
| Other `PAYMENT_MISMATCH` / `PAYMENT_REVERSED`                               | After identity agrees, inspect captured totals, line items, refund, and dispute evidence before any fulfillment.                                             |

A paid webhook redelivery for an already `submitted` or `simulated` order acknowledges its saved completed state after matching the Session and shop. It does not revalidate or backfill identity, rewrite payment facts, or repeat provider work. An unfinished order still requires its explicit saved identity.

For either identity failure, confirm the exact Stripe account/mode, Session, saved request and shop with read-only evidence. These gates stop before the failing attempt verifies or saves capture; preserve any payment recorded by an earlier attempt. An empty saved payment is not proof of nonpayment.

For `ORDER_IDENTITY_MISSING`, preserve the snapshot and stop dependent replay/provider mutations. Do not infer identity from current branding. Escalate to the owner and maintainer for a separately reviewed migration or payment-resolution plan; this workflow provides no supported backfill.

For an identity-related `PAYMENT_MISMATCH`, compare the Session's `metadata.storefront` with the saved `order.commerceIdentity`. Do not rewrite the snapshot or Stripe metadata to force a match. Resolve the evidence conflict with the owner/maintainer before an authorized replay; refund and dispute checks alone do not resolve an identity mismatch.

`COMMERCE_IDENTITY_CHANGED` affects new checkout creation, not paid-order fulfillment. Follow the [permanent commerce identity guidance](../../../docs/checkout-resilience.md#permanent-commerce-identity) to compare configuration with the pinned database value; do not treat it as a request to recreate or alter an order.

Use the code's current status vocabulary when diagnosing; this table explains decisions rather than replacing provider state validation. Logs expose the Stripe event ID and a fixed failure code, not raw exception/provider text.

## Act within the recovery authorization

Read the owner's recorded delegation from [owner intake](../store-owner-handoff/references/owner-intake.md) for operational work. Owner operation with agent help is the tentative model; it supplies no default authority to refund, cancel, replace, spend money, contact a customer, or enable unattended recovery beyond the implemented bounded workflow. Resolve only the responsibilities relevant to this incident and reuse explicit authorization already given.

An investigation request authorizes read-only diagnosis. Prepare the exact proposed action and its expected effect before seeking any required authorization. Existing explicit authorization persists, but it must cover the action being taken.

Replaying a paid event can create or submit a real order once prerequisites recover. Treat replay as a fulfillment action, not a harmless connectivity test. After an authorized replay, read back the same session, durable record, and provider order to establish whether recovery completed. Do not wait indefinitely on Stripe retries; retries are finite.

Do not reset a claim, delete a checkout row, create a replacement, or repeat an uncertain production call merely because the original request timed out. Printify documentation does not establish atomic idempotency for repeated create calls. If no matching order can be established, prepare a merchant decision about payment resolution or a separately reviewed replacement.

A Stripe refund and Printify cancellation are independent actions with separate consequences. Refund authorization does not authorize a Printify cancellation or replacement, and a refund does not automatically stop manufacturing. Inspect the current provider state before proposing cancellation; do not promise it is possible after production starts. A request to investigate a refund is not an instruction to issue it. Consult current [Stripe refund guidance](https://docs.stripe.com/refunds) when preparing that action.

Preserve order/session identity and the fulfillment claim for the supported event-replay period. Customer-data redaction under the merchant's retention policy must not erase deduplication evidence. Do not add a cleanup task or alter retention as part of a single-order recovery.

## Close with verified evidence

Report the payment mode/status, current application state and failure code, matched provider order/status, action actually taken, and anything still requiring a merchant decision. State explicitly when provider state is unconfirmed. Do not claim physical quality, delivery, or production completion from a mockup, test payment, or local unit test.

For a code fix, run repository-required checks and the relevant fulfillment/webhook tests; use the isolated Postgres suite for concurrency or durability changes. Existing tests cover lost create/submission responses, destination conflicts, delayed payment, and duplicate events. Avoid reproducing an incident by creating a real duplicate or altering a production order.
