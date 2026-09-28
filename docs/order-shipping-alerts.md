# Owner shipping alerts

Optional internal alerts use this store's configured support email and its own verified Resend sender. Customer messages remain manual. Supabase's Resend SMTP configuration only serves Auth; it does not automatically provide credentials to the storefront worker.

## Behavior

- Once explicitly configured, the example Vercel schedule calls `/api/internal/order-alerts` hourly. The route requires `CRON_SECRET`, `ORDER_ALERTS_ENABLED=true`, and `VERCEL_ENV=production`. Previews and disabled installations cannot send.
- Runs after 9am in `storeConfig.timeZone` on weekdays excluding observed US federal holidays. Each run checks at most ten due orders, with a 45-second loop budget and bounded provider timeouts. A database advisory lock prevents overlapping workers for the same shop.
- Only verified captured live payments in the configured Printify shop qualify. Test, simulated, unverified and other-shop orders are excluded.
- A checkout saves its original handling maximum and calendar. Every order receives an early warning based on the handling window and time zone frozen with checkout.
- Reads Printify order identity and every line. Choice replacement products are matched using our preserved external line IDs; unmatched, missing, duplicated, canceled or unknown items never count as all shipped. “Submitted” alone is insufficient. A partial shipment keeps reminders active.
- Reads the original Stripe PaymentIntent and expanded charge, verifies identity/metadata/amount/mode, and stops on a confirmed full refund. Partial refunds, disputes and unavailable reads ask for owner review. The worker cannot submit orders, refund, or email customers.
- A reminder includes an exact `/admin/orders?order=<UUID>` link behind existing admin authorization, a Stripe payment link, customer contact, item details, original ship-by date, current checks, and a clearly unsent draft with placeholders for facts that only the owner can verify.
- The owner must check for known problems earlier, contact customers when a delay is known, record consent/cancellation/refund decisions, and track revised dates. Daily reminders do not replace that work. The app does not yet record revised customer deadlines or customer correspondence.

## Delivery and retries

The private `commerce.order_shipping_alerts` table records the current message, next check, send attempt, Resend receipt, and safe error code. It has RLS, no browser-role privileges, and grants only select/insert/update to the restricted app role. It keeps only the current message; completing an order clears its message body. Queries are scoped to the configured shop.

The exact recipient/body and daily idempotency key are saved before calling Resend. A lost response retries the same payload/key for at most 23 hours, inside [Resend's 24-hour deduplication window](https://resend.com/docs/dashboard/emails/idempotency-keys). After that, a later business day gets a fresh reminder rather than replaying an expired key. This may be the next day's reminder after an uncertain earlier send, not a guarantee about whether the earlier email reached the inbox. A successful retry counts as that day's email even if originally prepared the previous day. Shipment/refund is rechecked before retrying.

Resend acceptance is **not proof of inbox delivery**. Check the Resend email ID for delivery/bounce status. Sender misconfiguration, transport/storage failures and rejected sends produce non-200 cron results; no raw provider bodies, customer details or credentials enter logs. Each candidate advances its next-check time before provider I/O so one failing order does not starve the queue. Keep Vercel cron failure monitoring active and review the Orders/Printify pages manually during any outage. At higher volume, increase worker throughput before the due queue exceeds same-day capacity.

## Rollout

The template has no active schedules. Review hosting-plan support and merge the appropriate entries from `scripts/vercel-crons.example.json` into `vercel.json` only for an authorized setup.

1. Verify the fresh store database has the baseline `supabase/migrations/20260928000354_storefront_baseline.sql` and runtime grants before enabling alerts.
2. Configure production-only `RESEND_API_KEY` with sending access to the existing verified domain, and `ORDER_ALERT_FROM_EMAIL` using a verified sender on that domain. Set values directly in deployment secrets, never in notes, chat or source. Retain the existing Supabase SMTP setup. The recipient comes from the store support configuration; verify it belongs to the new store.
3. Keep `ORDER_ALERTS_ENABLED=false` until the production database/runtime grants, live Stripe read access, Printify read access, canonical site URL, admin login, and cron secret are verified. The Stripe credential must allow reading PaymentIntents with the expanded charge; a denied read is reported to the owner as unknown, not refunded.
4. Verify a real Resend message reaches the configured support inbox and that the order link opens the intended order after login. Use a clearly labeled owner test email; never manufacture a customer order or mark an order shipped to test this.
5. Deploy the matching website estimates. Verify the new store's saved merchant handling, transit and shipping-charge settings match its reviewed configuration. Then enable the production worker and verify its first run and receipt. The owner continues manual daily review until these checks pass.
6. Roll back sending with `ORDER_ALERTS_ENABLED=false`. Preserve the outbox and original checkout estimates; never extend old order promises during rollback.

## Validation

`SHIPPING_TEST_DATABASE_URL` must target an isolated local `store_shipping_test` database. The suite applies all migrations and runs the worker as `store_app_runtime`, testing eligibility, calendar boundaries, frozen windows, concurrency, ambiguous sends, daily deduplication, partial fulfillment, refunds and browser-role denial. Provider tests use fixtures; they do not prove Resend delivery or a production deployment.
