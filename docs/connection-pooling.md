# Database connections and isolated load testing

Runtime pools are shared across Next.js route bundles within one process, keyed by database credentials, TLS trust, workload and connection budget. Pools open lazily and keep the existing verified session connections. Transaction pooling cannot preserve the advisory locks used for duplicate-order prevention.

| Workload                                           | Maximum connections per process |
| -------------------------------------------------- | ------------------------------: |
| Catalog/gallery and publishing configuration edits |                               2 |
| Library and design-agent transactions              |                               2 |
| Public signup requests                             |                               1 |
| Checkout and fulfillment                           |                               4 |
| Checkout admission and provider budgets            |                               1 |
| Publishing worker                                  |                               1 |
| Catalog refresh workers                            |                               2 |
| Email and confirmation workers                     |                               2 |
| Order alerts                                       |                               1 |
| Total, when all workloads are active               |                              16 |

The template's admission limiter keeps its own one-connection budget. Its limits, identity checks and durable reservation behavior are unchanged. Library/agent transactions and signup bursts cannot consume storefront slots; publishing configuration mutations still share the storefront pool and can wait there on row locks. Admin isolation is partial.

Checked-out clients retain their sessions and locks until release. Released clients close after five idle seconds; Vercel lifecycle cleanup preserves that timer before suspension. Registry pools live for the process. Borrowing stores never close them; standalone script/test stores own and close their pools. Pool errors identify the workload without logging URLs, certificates or raw errors.

Each process has its own registry. Autoscaling, deployment overlap and background work can still exhaust the database-wide session budget. Monitor connections, waiting clients, errors and route latency together. Increasing a provider limit alone is not a capacity plan.

## Run the manual fixture

This test runs a configured test shop in an isolated production build, real routes and migrations, signed paid events and the restricted database role. Its catalog, payment, printing and email providers are loopback fixtures with synthetic credentials. Merchant configuration stays untouched. No real purchases or messages occur.

Create a new disposable PostgreSQL database, install the pinned dependencies, then run:

```sh
docker run --rm -d --name store-load-postgres --cpus=1 --memory=512m \
  -e POSTGRES_PASSWORD=local-commerce-test -e POSTGRES_DB=store_catalog_e2e \
  -p 127.0.0.1:65131:5432 postgres:17-alpine \
  -c max_connections=100 -c shared_buffers=64MB

pnpm test:commerce:build

CATALOG_E2E_DATABASE_URL=postgresql://postgres:local-commerce-test@127.0.0.1:65131/store_catalog_e2e \
  LOAD_RATES=1,10,25,50 LOAD_STAGE_SECONDS=60 \
  node --import tsx scripts/load/run-storefront.mjs

docker stop store-load-postgres
```

The runner accepts only the named loopback fixture database with no URL query overrides or fragments. It replaces the fixture schemas through the existing complete migration seed and clears the configured build's fetch cache. Run it while nothing else uses that fixture database or build. Four app processes share a temporary restricted login capped at 30 connections; the existing `store_app_runtime` login's password and limit stay unchanged. `LOAD_INSTANCES` accepts 1–8, `LOAD_STAGE_SECONDS` accepts 10–600, and `LOAD_RATES` accepts comma-separated rates up to 200.

Each visit requests home, shop and a product page with 500 ms think time. Five percent then check out and deliver a signed paid event. Synthetic provider calls wait 250 ms by default; `COMMERCE_PROVIDER_DELAY_MS` accepts 0–2000. The proxy simulates Vercel ingress with a distinct synthetic address for each new checkout; the concurrent-retry probe shares one address. This is fixture behavior, not a production trusted-header adapter.

Checkout admission remains enabled with the application's defaults, or the explicitly supplied `CHECKOUT_CAPACITY_LIMITS`. The report records the resolved limits. At defaults, the shared 60/minute checkout budget can become the boundary before database connections do. HTTP 429 responses count as failed visits and are also counted in `rateLimitedVisits`; they must not be described as database errors or a successful operating point. The runner stops increasing load above 1% failed visits or when its 512-visit ceiling drops arrivals. It never resets quota debt to make a stage pass.

After traffic, the runner waits for shared quota debt to refill (at most one minute) before an independent eight-request checkout retry probe. Admission may reject some retries; admitted attempts must still reconcile to one payment session. Eight signed events and a deliberately lost print response must produce exactly one print order and one submission. Every confirmed-paid session is checked, and app connections must drain to zero. Payment-fixture failures do not enter the paid-order list.

Response resets fail the affected request. Deadlines and client disconnects cancel upstream work. Sampler errors, unexpected exceptions, rejected promises, SIGINT and SIGTERM stop the run and enter cleanup. Reports become `completed` only after cleanup; failures and interruptions remain explicit. Cleanup stops owned processes and removes the temporary role when the database remains available. It cannot run after an uncatchable process kill.

Logs and JSON reports default to `.tmp/load-results/`; set `LOAD_OUTPUT` for a named directory. Reports include commit, dirty-tree status, source hash/version, configured build ID, resolved admission limits, topology, provider delay, latency, HTTP statuses, connection peaks and integrity results. Source hashing includes shared test support and migrations and represents deleted tracked files explicitly.

Run `node --test scripts/load/*.test.mjs` for the focused proxy, isolation and provenance regressions. These manual tests add no hosted job. The runtime configuration cases are part of the existing commerce gate, whose variable-specific refusal diagnostics remain intact.

## Interpret evidence

This template does not inherit another store's traffic measurements. Use only runs from this checkout with their complete workload and provenance. A completed run may contain deliberately overloaded stages; a usable operating point needs zero dropped arrivals, zero failed visits and acceptable latency.

The fixture does not reproduce Vercel autoscaling, Supavisor, internet latency, CDN/images, client JavaScript, or overlapping admin/cron work. Local machines and synthetic provider timings differ from a deployed store. Treat these results as reproducible local evidence, then validate an authorized deployment before claiming production capacity. Browser journeys separately verify the customer flow.
