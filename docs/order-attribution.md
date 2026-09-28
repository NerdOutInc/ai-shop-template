# Purchase sources and orders

The store owns its order history in `commerce.checkout_orders`. Stripe collects payment and Printify produces the shirts; neither is the only copy of an order. The private **Orders** admin page reads this database and separates confirmed payment captures from fulfillment progress.

## What is recorded

Before opening Stripe Checkout, the store saves the first eligible visit in the current browser tab with the checkout snapshot:

- Channel: organic search, paid, social, email, referral, or direct.
- Source/platform and referring hostname, when the browser or tagged link supplies them.
- Bounded `utm_source`, `utm_medium`, and `utm_campaign` labels.
- An allowed public landing pathname, capture time, and the method used to identify the source.

Use short campaign labels containing letters, numbers, hyphens, and underscores, for example `/shop?utm_source=instagram&utm_medium=social&utm_campaign=autumn_drop`. Labels are limited to 80 characters. Do not put customer details in campaign labels.

The first touch remains in the tab for at most 24 hours. Later internal navigation, Stripe returns, and checkout retries do not replace an already saved order's attribution. The source is a browser-supplied observation, not proof that an advertisement caused a sale. Referrer restrictions, blocked storage, another browser or device, and untagged links can leave attribution incomplete. Missing attribution displays as **Unknown**, it is never backfilled as Direct.

For Meta Shops handoffs, the isolated checkout entrance preserves only a recognized Facebook, Instagram, or Meta Shops source. It still strips checkout capabilities and campaign parameters before loading the application. Campaign details unavailable after that handoff remain unknown.

## Privacy and measurement

This first-party record does not depend on enabling Google conversion tracking or Meta Pixel. It does not send attribution to either provider or add it to Stripe or Printify metadata. Only a hostname and allowed pathname are retained, never a full referring URL, arbitrary query string, fragment, raw advertising click ID, coupon, or checkout capability.

Global Privacy Control and an explicit, current denial in either marketing preference suppress further capture and clear the tab's remembered attribution. An unset preference or disabled provider does not itself turn off the first-party record. The checkout endpoint also honors the `Sec-GPC: 1` request header. A later preference change does not rewrite an order already saved to the database.

## Payment and fulfillment

After verifying the Stripe Session, line items, totals, and captured charge, the signed webhook saves a durable payment capture before attempting delivery-address capture or Printify work. It records live/test mode, the payment reference, Stripe's charge creation date, billing customer name/email when available (the delivery recipient stays in the order’s separate shipping address), and final subtotal, shipping, tax, and total in cents. The charge date is not an exact settlement time for delayed payment methods. Repeated events retain the first matching capture. A disagreement fails closed rather than overwriting it.

The dashboard labels the billing customer and delivery recipient separately so gifts are unambiguous. When a payment has no billing name and only a shipping name is available, the row labels it **Recipient** rather than treating it as a billing customer.

The dashboard defaults to confirmed live captures. Filters expose test captures and attempts with no recorded payment verification. A pending checkout, a quote, or a Printify state alone is not treated as a confirmed sale. Submitted orders are not reprinted when an administrator views them.

**Payment captured** describes the verified checkout payment. The dashboard is not a refund or dispute ledger: use its Stripe link for current financial status. Fulfillment labels describe the store's durable submission stages; **Sent to Printify** does not mean shipped or delivered. Existing recovery safeguards and provider request identities remain in force.

## Setup and verification

The [fresh database baseline](../supabase/migrations/20260928000354_storefront_baseline.sql) includes private payment captures and shop-scoped reporting. Configure the runtime role, administrator authorization and Printify shop through [store setup](store-setup.md).

Payment persistence gates fulfillment, including simulation. Storage failures report `PAYMENT_CAPTURE_UNAVAILABLE` and let Stripe retry; immutable disagreements report `PAYMENT_CAPTURE_CONFLICT`. Repair the cause through [order recovery](../.agents/skills/store-order-recovery/SKILL.md). Never bypass the capture write to resume printing.

Local verification covers source sanitization and privacy choices, immutable checkout retries, verified payment capture before fulfillment failures, duplicate events and database durability, and authorized shop-scoped reporting with filters and pagination. The reporting database suite uses its own disposable `store_orders_test` database through `ORDERS_TEST_DATABASE_URL`; never point test variables at a real store database.
