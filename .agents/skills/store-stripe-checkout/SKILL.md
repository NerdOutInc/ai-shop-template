---
name: store-stripe-checkout
description: Configure and verify this store's Stripe-hosted Checkout, signed payment webhook, and connection to Printify fulfillment. Use for sandbox setup, payment configuration, or preparing an authorized live launch.
---

# Connect Checkout to the store

Configure the existing payment flow and prove what works. A successful payment deserves exactly one shirt order, not an encore.

## Establish the current contract

Read [store setup](../../../docs/store-setup.md), [environment names](../../../.env.example), [package versions](../../../package.json), and [commerce service configuration](../../../src/features/checkout/get-commerce-services.server.ts). Read the relevant installed Stripe guidance and refresh provider facts with official Stripe documentation. Prefer an available Stripe documentation connector or `stripe docs`; browser documentation is a fallback.

Use the API version pinned in the current commerce client for the webhook's snapshot payload. Do not upgrade the SDK or API as an incidental setup step. Read the exact current SDK from package.json and API version from the commerce client.

Establish the exact store origin, Printify shop, Stripe account/environment, deployment environment, and database before acting. For a new brand, obtain its shipping destinations/rates, currency, support details, and tax decision. The current code supports USD, standard shipping to the 50 US states plus DC, and a flat per-shirt rate. Different products, regions, or currencies need an explicit implementation scope, not environment-only promises.

Each store must use its own Stripe account, database, Printify shop and other dedicated resources under the [confirmed defaults](../store-template-readiness/references/store-defaults.md). Collect pricing/shipping and delegation through [owner intake](../store-owner-handoff/references/owner-intake.md); sample template rates are unapproved examples, not the owner's policy. Obtain explicit approval for going live and testing a purchase. Clearly distinguish a simulated sandbox test from a paid live test, and reuse already-granted approval for the exact test.

## Configure the connection

1. **Database:** Follow [runtime login provisioning](../../../docs/store-setup.md#provision-the-runtime-login) and the TLS checks. The baseline creates `store_app_runtime` without a password; let the owner enter it privately with `psql`’s `\password store_app_runtime`. Use `store_app_runtime.PROJECT_REF` through the shared session pooler or `store_app_runtime` directly, and verify the connected role and grants. Keep migration-owner credentials out of application configuration. This implementation needs a direct Postgres connection or session pooler because it holds session advisory locks; transaction pooling on port 6543 is rejected. Set `DATABASE_URL` with `sslmode=verify-full` for non-loopback hosts; URL `host` and `port` query overrides are rejected. Set the optional `DATABASE_SSL_CA` when the provider's CA is not in the system trust store, following the setup instructions without exposing values. A migration file being present does not establish that the target database has it.
2. **Printify:** Confirm the chosen shop with a read-only API check. Development/sandbox work uses a read-only token with the needed `products.read`, `shops.read`, and `orders.read` access; it does not need `orders.write`. The documented production `PRINTIFY_API_TOKEN` additionally needs `orders.write` for authorized live fulfillment. Confirm Manual order approval and Printify's own payment method/balance before live fulfillment. Stripe receives customer payments; Printify separately charges for manufacturing and shipping.
3. **Stripe server key:** Start with a restricted sandbox key in `STRIPE_SECRET_KEY`. Current documented permissions are write access to Checkout Sessions, and Shipping Rates; read access to Checkout line items/Products, PaymentIntents, and Charges; and Tax Settings/Registrations reads when tax is used. Check actual request failures to refine permissions. Do not broaden an unrelated key to solve a missing permission. Stripe CLI login alone does not supply this application's server API key. Hosted redirect Checkout needs no browser publishable key.
4. **Signed webhook:** In the chosen Stripe account/environment, create or reuse the appropriate snapshot destination at `https://<store-origin>/api/webhooks/stripe`. Select the pinned API version and `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and `checkout.session.async_payment_failed`. Store that destination's signing secret as `STRIPE_WEBHOOK_SECRET` in the matching deployment. Read back the URL, event selection, mode, and payload/API version.
5. **Local listener:** If testing locally, run `stripe listen --forward-to localhost:<port>/api/webhooks/stripe`. Its `whsec_...` is separate from a hosted endpoint's signing secret. Match the port and secret to the active server, then restart after environment changes. Worktree environment copying does not start the listener/database or synchronize later key rotation.
6. **Shipping and tax:** Confirm the configured policy against [cart shipping](../../../src/features/checkout/calculate-cart-shipping.ts) and customer-facing policy pages. The hosted flow calculates first-item and additional-item shipping charges locally from the owner-reviewed configuration. `STRIPE_TAX_ENABLED=false` means no tax is collected. Enable it only after the merchant's tax setup and applicable registrations are established; the code checks active settings and at least one active registration, which does not guarantee collection in every destination.

Keep `PRINTIFY_FULFILLMENT_ENABLED=false` for sandbox work. The application independently prevents test payments from creating Printify orders, even if that flag is true. With live keys and fulfillment disabled, live Checkout creation is intentionally blocked. Inspect the existing authorization before changing production configuration or enabling real fulfillment; setup authorization does not itself authorize a purchase.

## Preserve the payment boundaries

Use [Checkout creation](../../../src/features/checkout/create-checkout.server.ts), [the webhook route](../../../src/app/api/webhooks/stripe/route.ts), [paid-session verification](../../../src/features/checkout/verify-paid-session.server.ts), and [fulfillment](../../../src/features/checkout/fulfill-checkout.server.ts) when changing behavior.

- Prices, shipping, published membership, live variant availability, and production fingerprints are server-authoritative. Browser amounts are not a payment instruction.
- Verify the raw webhook body with `Stripe-Signature` and the correct destination secret before processing. The success page reports status; it never creates an order.
- An unpaid completion event must wait for payment success. A failed delayed payment must not print.
- Preserve the fixed checkout snapshot, request identity, stable Stripe idempotency payload, and durable fulfillment states. Capture the paid Session's validated shipping details once; do not substitute billing or later Customer addresses.
- Keep provider secrets and customer data out of logs, screenshots, journal entries, and handoff artifacts. Report fixed failure codes and non-sensitive identities instead.

## Verify through the actual store

Exercise one- and multi-item shipping totals, opening Checkout, cancellation/return, and a Stripe sandbox payment with delivery details entered in Checkout. Establish all of these independently: payment succeeded, the signed webhook reached the intended deployment, the stored order is `simulated`, the success UI reflects simulation, and Printify has no newly created order. Replay the actual completed event and confirm the same stored order remains simulated. Where the account supports delayed methods, verify unpaid completion waits and later success completes simulation.

A generic `stripe trigger` fixture has no persisted application order snapshot and deliberately cannot prove this store's fulfillment. User-reported account setup, a successful CLI login, a return-page visit, and passing mocked tests each establish different facts; none proves a real paid order reached production.

For analytics, read [conversion measurement](../../../docs/store-setup.md#conversion-measurement). The browser attempts `purchase` after the customer returns and the status lookup validates a live, complete, paid Session against its stored order. Sandbox and simulated payments produce no purchase summary; paid orders awaiting fulfillment or needing assistance can count. This event does not prove webhook delivery or a Printify order, and missing analytics does not establish payment failure. Browser markers record attempts, not confirmed ingestion; events can be missing or duplicated, and refunds are not subtracted. Use Stripe for authoritative sales and revenue.

For code changes, run the required repository checks plus the affected checkout/webhook tests. Use the disposable local database instructions for concurrency/durability tests; a skipped database suite is not a pass. Reserve a real payment/Printify production test for explicit authorization, then verify the exact variant, quantity, address, single provider order, and production state.

Report configured, sandbox verified, live verified, and pending items separately. If failures concern a paid order or an uncertain provider mutation, use [store-order-recovery](../store-order-recovery/SKILL.md).

## New-brand portability

Find all current store identity readers and writers before replacing brand configuration: metadata `storefront`, idempotency prefixes, Printify order labels/User-Agent, origin, shipping rules, and currency/destination validation. Existing pending orders depend on their saved identities and payloads; do not rewrite them during rebranding. A fresh store needs fresh provider identities and secrets, not a copy of this brand's production environment.

Include [purchase conversion validation](../../../src/features/checkout/build-purchase-conversion.server.ts) in that audit: its store metadata and USD amount checks must agree with Checkout creation and paid-session verification after an authorized brand or currency change, or valid sales can disappear from analytics.

Official references: [Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted), [webhooks](https://docs.stripe.com/webhooks), [restricted keys](https://docs.stripe.com/keys/restricted-api-keys), [key storage](https://docs.stripe.com/keys-best-practices), [Stripe Tax setup](https://docs.stripe.com/tax/set-up).
