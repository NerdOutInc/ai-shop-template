# Checkout capacity and payment identity

Checkout has two jobs: open quickly for customers and leave enough provider capacity to fulfill paid orders. Origin validation helps browsers, but it does not authenticate a caller. A script can send the same Origin.

## Database admission

Apply every migration, including the checkout capacity and commerce identity migrations, before opening checkout. Set `CHECKOUT_RATE_LIMIT_SECRET` to a separate random secret of 32–256 characters. Every replica sharing a database must use the same secret. Checkout and public status admission fail closed when the secret or database is unavailable; payment webhooks do not depend on this secret or the admission gate.

A short PostgreSQL transaction admits each validated checkout request before order locks or provider calls. Its persisted buckets coordinate all replicas and deployments using that database:

| Budget                      | Refill              | Maximum immediate burst |
| --------------------------- | ------------------- | ----------------------- |
| Client network              | 6 requests/minute   | 6 requests              |
| All checkout requests       | 60 requests/minute  | 30 requests             |
| Status checks per client    | 30 requests/minute  | 10 requests             |
| All status checks           | 120 requests/minute | 20 requests             |
| Public Stripe Session reads | 120 reads/minute    | 10 reads                |
| Live checkout product reads | 120 reads/minute    | 20 reads                |

These are continuously refilling budgets, not calendar-minute counters. Published variant, price and shipping checks reject invalid carts before reserving expensive capacity or contacting Printify. Validated quotes then reserve one read per distinct product immediately before the live reads start. Invalid carts still consume ingress capacity. Public status lookups and resumed checkout Session reads share one Stripe-read budget, independently of the client buckets; the normal five-second status poll fits the client allowance. Signed webhooks bypass public admission and read budgets. Failed provider requests keep their reservation, preventing unlimited outage retries. A retry with an existing Stripe Session uses the same saved Session and does not spend product-read capacity. Retries still consume ingress capacity; a rejected request retains its request ID and saved order for later retry. Responses use HTTP 429 with `Retry-After: 60`, and private no-store caching.

Stripe [documents endpoint and account limits](https://docs.stripe.com/rate-limits); the public-read allowance leaves room for paid webhooks rather than consuming its per-endpoint ceiling. It bounds calls from this application, not Stripe SDK retries or other clients.

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

## Launch checks and remaining operational limits

Before live traffic, review the deployment's [Vercel WAF rate-limit controls](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting) for `POST /api/checkout` and `GET /api/checkout/status`. Check the plan's available protections, tune thresholds against ordinary customer traffic, and configure spend alerts plus alerts for repeated `Checkout fulfillment needs retry` failures. Do not apply anonymous-checkout challenges or rate rules to signed payment webhooks. These dashboard controls need deployment-specific verification; the repository does not enable a paid service or claim those controls are active.

Different Printify shops and access tokens in the same account share its API budgets. A second shop or token is not quota isolation. Use a separate account when independent capacity is necessary, or coordinate the shared account's workers and traffic. This application's database budget cannot police another store's database or an external tool.

The full external review identifies these remaining constraints. They are explicit follow-up work, not claims that rate limiting removes every failure mode:

| Finding                                               | Current disposition                                                                                                                                                                                                                                                | Follow-up owner                                                                                                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `abuse-2`: order-create 429 recovery                  | Preserve the uncertain-create state and reconcile before retrying. A definitive guarantee that Printify did not accept the create is needed before automatically resetting it; publishing callbacks do not establish order-create delivery semantics.              | Maintainer to confirm the provider contract; store operator to use the order-recovery workflow for an affected paid order.                                      |
| `abuse-3`: checkout pool contention                   | Ingress is bounded before acquiring the three-connection order pool, but slow accepted quotes can still delay a webhook sharing that pool. Stripe retries the failed webhook.                                                                                      | Maintainer to design a reserved fulfillment connection or separate pool within the hosting connection budget and test it under slow-provider contention.        |
| `abuse-4`: abandoned snapshot retention               | No automatic deletion is added. `payment = null` does not establish nonpayment when capture/webhook processing failed, and a lost Stripe creation response may leave no saved Session ID.                                                                          | Maintainer and owner to choose a retention policy with authoritative Stripe reconciliation before deletion; do not purge paid or uncertain orders by age alone. |
| `abuse-6`: large-shop uncertain-create reconciliation | The bounded full scan preserves duplicate detection. Above 100 pages, automatic reconciliation fails explicitly and the operator needs a verified provider order ID. No documented ordering/filter guarantee supports stopping at an early match or old timestamp. | Maintainer to obtain a supported lookup contract or design durable reconciliation; store operator to follow the existing manual recovery workflow.              |

Use the [order recovery skill](../.agents/skills/store-order-recovery/SKILL.md) for paid-order incidents. Avoid recreating an uncertain provider order to clear a retry error. One shirt order is plenty of shirt order.
