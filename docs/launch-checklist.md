# Launch verification

Use this checklist with [store setup](store-setup.md). Record non-secret evidence, the target environment, deployed revision and verification date in ignored `.store-setup.local.json`. Mark each item **verified**, **pending**, **blocked** or **not applicable with reason**. Environment presence is configuration evidence, not proof that a provider answered. The launch checklist should not grade its own homework.

## Brand and business choices

- [ ] `src/lib/store-config.ts` contains the owner's name, store ID, voice, real support contact and approved assets; no template placeholders remain.
- [ ] Public logo, favicon, home and theme are inspected in the actual storefront on desktop and a narrow viewport, including keyboard focus and contrast.
- [ ] Prices, enabled colors/sizes, currency, destination coverage and agent delegation are confirmed. The current supported scope is USD/50 US states plus DC.
- [ ] First/additional-shirt shipping amounts and delivery estimates are reviewed against the real provider and owner policy; `commerce.shippingConfirmed=true` is justified.
- [ ] Shipping, returns and privacy copy is owner-reviewed and implemented before `policies.published=true`; the brand is actually ready before `configured=true`.

## Resources and access

- [ ] This store's repository, permanent domain, deployment project, Supabase project, Printify shop, Stripe account and two Blob stores are identified and isolated from other stores.
- [ ] Current hosting/service costs and terms are within the owner's authorization. DNS and domain ownership are verified for this store.
- [ ] All migrations are applied to the intended database. The [restricted runtime login](store-setup.md#provision-the-runtime-login) has its privately provisioned password, verified TLS, correct connected role and required grants; browser-role denial checks pass and no app superuser workaround is in use.
- [ ] Public mockup and private artwork stores use the correct credentials and exact build-time hostname. Private originals are inaccessible anonymously.
- [ ] Owner email-code delivery, initial admin claim, login/recovery and membership revocation work. Device passkey checks are completed or explicitly pending.
- [ ] Agent grants use the intended owner/scopes/expiry and private credential file. No secrets or private owner data appear in Git or setup progress.

## Products and publishing

- [ ] The first reviewed Printify product has an explicit garment/provider/variant/placement/pricing profile; no inherited base product is required.
- [ ] Approved private artwork revision and upload provenance are reconciled before image publication; uncertain creates have not been blindly retried.
- [ ] Signed publication is durably received, processed and acknowledged once. Saved drafts do not change public snapshots.
- [ ] Every active garment has a complete category/profile. Newly published products remain hidden until an authorized Show or schedule.
- [ ] Selected colors/sizes/prices, public raw/optimized mockups and exact standalone artwork slide work on the real product gallery, including color changes.
- [ ] The example schedules have been reviewed and explicitly merged into `vercel.json` or replaced with verified equivalent triggers. Authentication and actual scheduled worker completion are proven.
- [ ] Stock/popularity observations are fresh and feeds/storefront behave correctly during stale/unavailable cases. Optional monitor URL, secret and incident recipient are verified.

## Checkout and fulfillment

- [ ] Stripe sandbox account/key and signed snapshot webhook are verified on this deployment with the pinned API version and three required Checkout events.
- [ ] Through the store: single/multiple item shipping, invalid/unavailable variants, Checkout open/cancel/return and a complete sandbox payment work.
- [ ] The test order is durably simulated and event replay does not duplicate it; Printify has no new test-generated order.
- [ ] Tax configuration matches the owner's choices; disabled tax means no tax collection. Provider account checks do not establish all legal obligations.
- [ ] Printify uses Manual approval with a merchant payment method/balance ready for authorized fulfillment.
- [ ] Optional real purchase has explicit scope/budget and independently verified payment, one provider order, exact items/address and production state. Otherwise mark it pending; do not manufacture one to tick a box.
- [ ] Physical sample and delivery evidence are verified or clearly pending for the owner's launch decision.

## Channels and operations

- [ ] Intended merchant feeds authenticate, import correct variant IDs/images/prices and match website shipping/returns. Ownership, claim, import and listing approval are recorded separately.
- [ ] Optional Meta/Google marketing has this store's own destinations, reviewed consent/account settings and authorized activation. Denial, withdrawal, GPC and private/checkout URL protections pass isolated tests.
- [ ] Actual page/purchase receipt is recorded separately from an Active tag or successful configuration response. Stripe remains the revenue ledger.
- [ ] Support ownership, payment/webhook failures and uncertain-order recovery are assigned. Optional shipping reminders have a verified sender, schedule and real recipient receipt; customer correspondence remains a separate action.

## Code and release

- [ ] `pnpm check` passes. Full local/CI integration requirements pass before merge; any unavailable suite is explicit and cannot count as passed.
- [ ] `pnpm check:template` passes for template changes. `pnpm setup:check --launch` passes for the configured store; this is a configuration gate only.
- [ ] The exact authorized production revision, origin and environment are read back after deployment. Normal Git integration may trigger deployment: account for that before pushing or merging.
- [ ] Live activation and product-publication actions remain within actual owner instructions. Reuse authority already given; ask only for a concrete uncovered decision.

Return a short receipt with storefront/admin URLs, verified results, pending external checks, and the next owner action if one is required. A store may have working checkout while sample delivery or a merchant channel is pending; state those facts separately rather than collapsing everything into “launched.”
