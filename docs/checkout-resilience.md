# Checkout capacity and payment identity

Checkout has two jobs: open quickly for customers and leave enough provider capacity to fulfill paid orders. Origin validation helps browsers, but it does not authenticate a caller. A script can send the same Origin.

## Database admission

Apply every migration, including the checkout capacity and commerce identity migrations, before opening checkout. Set `CHECKOUT_RATE_LIMIT_SECRET` to a separate random secret of 32–256 characters. Every replica sharing a database must use the same secret. Admission fails closed when the secret or database is unavailable; payment webhooks do not depend on this secret or the admission gate.

A short PostgreSQL transaction admits each validated checkout request before order locks or provider calls. Its persisted buckets coordinate all replicas and deployments using that database:

| Budget                      | Refill             | Maximum immediate burst |
| --------------------------- | ------------------ | ----------------------- |
| Client network              | 6 requests/minute  | 6 requests              |
| All checkout requests       | 60 requests/minute | 30 requests             |
| Live checkout product reads | 120 reads/minute   | 20 reads                |

These are continuously refilling budgets, not calendar-minute counters. New quotes reserve one read per distinct product before the live reads start. Failed provider requests keep their reservation, preventing unlimited outage retries. A retry with an existing Stripe Session uses the same saved Session and does not spend product-read capacity. Retries still consume ingress capacity; a rejected request retains its request ID and saved order for later retry. Responses use HTTP 429 with `Retry-After: 60`, and private no-store caching.

Printify documents a [global 600 requests/minute limit](https://developers.printify.com/). Checkout deliberately uses only part of it, leaving headroom for fulfillment, publishing and other account activity. This budget does not coordinate independent databases or tools using that account; stores must use dedicated resources, and account-wide traffic still needs monitoring. This is an application capacity control, not a network-level denial-of-service firewall.

## Trusted anonymous identity

Only the server's `VERCEL=1` deployment environment permits trusting `x-vercel-forwarded-for`. Vercel [documents its ingress headers and overwrite behavior](https://vercel.com/docs/headers/request-headers). Generic `X-Forwarded-For`, `X-Real-IP`, cookies, request IDs and user-supplied identity fields are ignored. Missing, malformed or multi-address Vercel identity fails closed.

The server normalizes addresses, groups IPv6 addresses by /64, and stores only a keyed SHA-256 hash. Network keys expire after ten idle minutes; subsequent admitted traffic removes expired rows in bounded batches. No raw address, header, cookie or provider error detail is logged. Shared networks share the client budget. Changing the hash secret resets client grouping, so rotate intentionally across all replicas; the shared budgets remain in force.

Other hosting environments use one conservative shared client bucket. Do not set `VERCEL=1` on a self-hosted server or trust arbitrary forwarding headers to obtain separate clients. Add and test an explicit trusted-ingress adapter before operating another host at production traffic levels. Local tests need no proxy headers.

## Permanent commerce identity

Set `storeConfig.commerce.identity` to a store-specific slug before the first checkout. It is distinct from the cosmetic `storeConfig.id`, name, domain and artwork. PostgreSQL pins the identity on the first new checkout; the application role cannot change or delete it. Later attempts to create new orders with another identity fail clearly. Rebranding should keep this value, database, Stripe account and Printify shop.

Each order snapshot freezes its commerce identity. Stripe metadata, paid-session checks, fulfillment, owner payment lookup and conversion validation use that saved identity. Cosmetic rebranding therefore cannot silently ignore a paid order. A retry without a recorded Stripe response preserves the original metadata and idempotency key; a saved Session remains reusable. Unknown snapshots without the required identity fail explicitly and are not assigned the latest branding. There is no imported-store metadata compatibility or automatic backfill.

A new business with different provider accounts needs its own database and identity. Changing the pinned identity is not a supported rebrand operation. For a paid-order incident, use the order recovery workflow and the saved provider/session evidence.

## Verification

The focused suites cover concurrent admission across separate pools, distributed client bursts, distinct customers, spoofed proxy headers, IPv6 rotation, provider quota exhaustion/refill, storage failure, runtime/browser database permissions, identity pinning, rebranding and payment replay. The capacity suite uses `CHECKOUT_CAPACITY_TEST_DATABASE_URL` with an isolated local `store_capacity_test` database, separate from `CHECKOUT_TEST_DATABASE_URL` and `store_commerce_test`. Never point either variable at a store database.
