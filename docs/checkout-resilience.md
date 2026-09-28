# Checkout capacity and payment identity

Checkout has two jobs: open quickly for customers and leave enough provider capacity to fulfill paid orders. Origin validation helps browsers, but it does not authenticate a caller. A script can send the same Origin.

## Database admission

Apply every migration, including the checkout capacity and commerce identity migrations, before opening checkout. Set `CHECKOUT_RATE_LIMIT_SECRET` to a separate random secret of 32–256 characters. Every replica sharing a database must use the same secret. Checkout and public status admission fail closed when the secret or database is unavailable; payment webhooks do not depend on this secret or the admission gate.

A short PostgreSQL transaction admits each validated checkout request before order locks or provider calls. Status requests spend only their client allowance before the saved-order lookup; nonexistent Sessions never spend a shared budget. Its persisted buckets coordinate all replicas and deployments using that database:

| Budget                       | Refill              | Maximum immediate burst |
| ---------------------------- | ------------------- | ----------------------- |
| Client network               | 6 requests/minute   | 6 requests              |
| All checkout requests        | 60 requests/minute  | 30 requests             |
| Status checks per client     | 30 requests/minute  | 10 requests             |
| Unresolved status reads      | 120 requests/minute | 20 requests             |
| Public Stripe Session reads  | 120 reads/minute    | 10 reads                |
| Live checkout product reads  | 120 reads/minute    | 20 reads                |
| Each unresolved Session read | 1 read/4 seconds    | 1 read                  |

These are continuously refilling budgets, not calendar-minute counters. Published variant, price and shipping checks reject invalid carts before reserving expensive capacity or contacting Printify. Validated quotes then reserve one read per distinct product immediately before the live reads start. Invalid carts still consume ingress capacity. Failed provider requests keep their reservation, preventing unlimited outage retries.

After a known order is found, unresolved status reads atomically reserve the shared status budget, the shared Stripe budget and a Session-specific allowance. Resumed checkouts use the same Stripe and Session allowances. A rejected duplicate rolls back every shared debit. Session bucket names contain only a SHA-256 hash, never the Session capability. The normal five-second browser poll fits the four-second Session interval. A known unresolved order whose read is rate-limited returns `pending` without a purchase summary, so ordinary confirmation polling continues instead of stopping on a transient capacity error. Client admission still returns HTTP 429 with `Retry-After: 60`; storage/configuration failures remain errors. All responses use private no-store caching.

Once a webhook has saved the verified capture, status and conversion summaries use that immutable payment record without Stripe reads, including orders awaiting fulfillment or needing assistance. Saved failed payments and expired Sessions also need no Stripe read. Expiration is saved only after a matching Stripe Session reports it, under the order lock after rechecking for concurrent payment; the local checkout expiry time alone cannot classify a delayed payment as expired. Completed fulfillment states are acknowledged without a new read; no missing payment facts are backfilled. A capture reports the payment at checkout, not a current refund or dispute balance; a recorded `PAYMENT_REVERSED` still suppresses conversion summaries. Signed webhooks bypass all public admission/read budgets.

A retry with an existing Stripe Session uses the same saved Session and does not spend product-read capacity. Checkout retries still consume ingress capacity; a rejected request retains its request ID and saved order for later retry.

### Tune capacity before a busy drop

Set the optional server-only `CHECKOUT_CAPACITY_LIMITS` to strict JSON. Omitted budgets and fields retain the table's defaults. Each budget accepts integer `perMinute` and `burst` values from 1 to 60,000; `providerRead.burst` must be at least 20 so the largest valid cart fits. Unknown keys, malformed JSON and invalid values fail closed when those budgets are used. Cleanup retains outstanding budget debt through its full refill horizon plus ten minutes, including slow custom budgets. The bounds validate arithmetic, not a provider's allowance. Invalid tuning cannot block signed payment webhooks. Use identical values on every replica sharing the database, and coordinate deployment changes so mixed configurations do not alternately apply different limits.

```dotenv
CHECKOUT_CAPACITY_LIMITS={"ingress":{"perMinute":60,"burst":30},"status":{"perMinute":120,"burst":20},"stripeRead":{"perMinute":120,"burst":10},"providerRead":{"perMinute":120,"burst":20}}
```

The fixed client and four-second Session ceilings still apply. Measure webhook latency, ordinary retries and expected concurrent customers before increasing shared budgets. With a delayed webhook, each new checkout can make up to twelve status polls at five-second intervals: 60 new checkouts/minute could therefore need 720 status reads/minute while payment remains unresolved. Most paid orders stop consuming Stripe capacity as soon as capture is saved. An unresolved burst above the configured allowance waits for later polls; tune status and Stripe budgets together against expected traffic and verified account limits, and test with local provider mocks before a launch. Raising only ingress does not raise downstream capacity.

Stripe [documents endpoint/account limits and rolling read allocations](https://docs.stripe.com/rate-limits). In addition to per-second limits, reads average at most 500 per transaction over 30 days, with a minimum allocation of 10,000/month. The default application's two reads/second is not a monthly allowance: sustained traffic would exceed many stores' read allocations. Monitor account-wide reads, webhook delays and repeated unresolved-session polls; do not raise limits based only on the per-second ceiling. These budgets bound application calls, not SDK retries or other clients.

Printify documents a [global 600 requests/minute limit](https://developers.printify.com/). Checkout deliberately uses only part of it, leaving headroom for fulfillment, publishing and other account activity. This budget does not coordinate independent databases or tools using that account; stores must use dedicated resources, and account-wide traffic still needs monitoring. This is an application capacity control, not a network-level denial-of-service firewall. At the defaults, about ten client networks each sending six schema-valid junk carts/minute can consume the entire 60/minute checkout allowance without a provider call; five fresh networks can spend the initial 30-request burst. A per-IP rule set at the same allowance does not prevent that distributed lockout. Review aggregate edge protections, traffic/spend alerts and customer-impact signals alongside these configurable limits.

## Trusted anonymous identity

Only the server's `VERCEL=1` deployment environment permits trusting `x-vercel-forwarded-for`. Vercel [documents its ingress headers and overwrite behavior](https://vercel.com/docs/headers/request-headers). Generic `X-Forwarded-For`, `X-Real-IP`, cookies, request IDs and user-supplied identity fields are ignored. Missing, malformed or multi-address Vercel identity fails closed.

The server normalizes addresses, groups IPv6 addresses by /64, and stores only a keyed SHA-256 hash. Network keys expire ten minutes after their budget fully refills; subsequent admitted traffic removes expired rows in bounded batches. No raw address, header, cookie or provider error detail is logged. Shared networks share the client budget. Changing the hash secret resets client grouping, so rotate intentionally across all replicas; the shared budgets remain in force.

Other hosting environments use one conservative shared client bucket. Do not set `VERCEL=1` on a self-hosted server or trust arbitrary forwarding headers to obtain separate clients. Add and test an explicit trusted-ingress adapter before operating another host at production traffic levels. Local tests need no proxy headers.

## Permanent commerce identity

Set `storeConfig.commerce.identity` to a store-specific slug before the first checkout. It is distinct from the cosmetic `storeConfig.id`, name, domain and artwork. PostgreSQL pins the identity on the first new checkout; the application role cannot change or delete it. Later attempts to create new orders with another identity fail clearly. Rebranding should keep this value, database, Stripe account and Printify shop.

Each order snapshot freezes its commerce identity. Stripe metadata, paid-session checks, fulfillment, owner payment lookup and conversion validation use that saved identity. Cosmetic rebranding therefore cannot silently ignore a paid order. A retry without a recorded Stripe response preserves the original metadata and idempotency key; a saved Session remains reusable. Unknown snapshots without the required identity fail explicitly and are not assigned the latest branding. There is no imported-store metadata compatibility or automatic backfill.

A new business with different provider accounts needs its own database and identity. Changing the pinned identity is not a supported rebrand operation. For a paid-order incident, use the order recovery workflow and the saved provider/session evidence.

`COMMERCE_IDENTITY_CHANGED` blocks creation of a new checkout because `storeConfig.commerce.identity` differs from the value already pinned in `commerce.store_identity`. First verify the deployment is using the intended store database, then read the pinned identity and restore the application configuration to that exact value through the normal reviewed deployment process. Do not edit or delete the pinned row to make a rebrand pass. A pinned-identity migration is outside the supported rebrand workflow and requires a separate reviewed plan and explicit owner authorization. Existing saved checkouts and paid-order recovery continue using their snapshots.

After matching the saved Session and Printify shop, redelivery for a `submitted` or `simulated` order returns that saved completed state without changing the snapshot, payment record or failure code. This is stable acknowledgment, not legacy metadata compatibility or a backfill. Unfinished snapshots missing `commerceIdentity` still fail explicitly with `ORDER_IDENTITY_MISSING` before payment verification or provider work.

This template has no automatic or supported in-flight identity backfill. An existing deployment with unfinished snapshots that lack `commerceIdentity` must finish or otherwise resolve those checkouts under its previous supported runtime before adopting this contract, or arrange a separate evidence-based, owner-approved migration reviewed by a maintainer before deployment. Do not guess identity from current branding, rewrite Stripe metadata to force a match, discard a paid/uncertain order, or suggest a routine SQL backfill. Empty local payment facts do not establish that Stripe never captured payment.

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
