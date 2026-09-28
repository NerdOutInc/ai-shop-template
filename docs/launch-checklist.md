# Launch verification

Use this checklist with [store setup](store-setup.md). Record non-secret evidence, the target environment, deployed revision and verification date in ignored `.store-setup.local.json`. Mark each item **verified**, **pending**, **blocked** or **not applicable with reason**. Environment presence is configuration evidence, not proof that a provider answered. The launch checklist should not grade its own homework.

## Brand and business choices

- [ ] `src/lib/store-config.ts` contains the owner's name, store ID, voice, real support contact and approved assets; no template placeholders remain.
- [ ] Public logo, favicon, home and theme are inspected in the actual storefront on desktop and a narrow viewport, including keyboard focus and contrast.
- [ ] Prices, enabled colors/sizes, currency, destination coverage and agent delegation are confirmed. The current supported scope is USD/50 US states plus DC.
- [ ] First/additional-shirt shipping amounts and delivery estimates are reviewed against the real provider and owner policy; `commerce.shippingConfirmed=true` is justified.
- [ ] Shipping, returns and privacy copy is owner-reviewed and implemented before `policies.published=true`; the brand is actually ready before `configured=true`.

## Resources and access

- [ ] This store's repository, permanent domain, deployment project, Supabase project, Printify account/shop, Stripe account and separate public/private Blob stores (plus isolated preview storage where used) are identified and isolated from other stores.
- [ ] The owner has confirmed this repository's Dependabot alerts, automatic security updates, secret scanning and push protection in [repository security settings](#repository-security-and-merge-gate), following [dependency maintenance](dependency-maintenance.md#repository-security-settings). Record each actual setting and any plan/permission blocker; a checked-in Dependabot configuration does not enable these controls.
- [ ] The default branch actively requires **Required checks** after the workflow providing that aggregate result is available. Verify the saved rule and current check name against [the required merge gate](ci.md#required-merge-gate); **Foundation checks** alone is insufficient. Private-repository branch protection/rulesets require GitHub Pro, Team or Enterprise. Follow [the repository settings handoff](#repository-security-and-merge-gate).
- [ ] Vercel Pro/Enterprise supports the reviewed sub-daily worker cadence; current hosting/service costs and terms are within the owner's authorization. DNS and domain ownership are verified for this store.
- [ ] Supabase CLI `db push` applied migrations to the intended database and `migration list` confirms recorded history. The [restricted runtime login](store-setup.md#provision-the-runtime-login) has its privately provisioned password, verified TLS, correct connected role and required grants; browser-role denial checks pass and no app superuser workaround is in use.
- [ ] Public mockup and private artwork stores use the correct credentials and exact build-time hostname. Private originals are inaccessible anonymously.
- [ ] Before the first `/admin/setup`, unrestricted Supabase Auth signup was verified disabled in the intended project, with dated non-secret evidence. Setup stayed disabled across the migration/code rollout. All migrations, including [verified owner enrollment](../supabase/migrations/20260928203733_verified_owner_enrollment.sql), are applied. Verify the [reserved owner account and mailbox-code claim](admin-auth.md#owner-enrollment-guarantee); the app and `setup:check` do not verify the provider signup setting. Resolve unexpected existing accounts through [setup recovery](admin-auth.md#setup-recovery). Mark this not applicable only if the private library is disabled and owner setup is outside launch scope.
- [ ] Owner email-code delivery, initial admin claim, login/recovery and membership revocation work. Device passkey checks are completed or explicitly pending.
- [ ] Agent grants use the intended owner/scopes/expiry and private credential file. No secrets or private owner data appear in Git or setup progress.

## Products and publishing

- [ ] The first reviewed Printify product has an explicit garment/provider/variant/placement/pricing profile; no inherited base product is required.
- [ ] Approved private artwork revision and upload provenance are reconciled before image publication; uncertain creates have not been blindly retried.
- [ ] Signed publication is durably received, processed and acknowledged once. Saved drafts do not change public snapshots.
- [ ] Every active garment has a complete category/profile. Newly published products remain hidden until an authorized Show or schedule.
- [ ] Selected colors/sizes/prices, public raw/optimized mockups and exact standalone artwork slide work on the real product gallery, including color changes.
- [ ] The example schedules have been reviewed and explicitly merged into `vercel.json` (supported by the automatic launch check); an alternative scheduler requires separately reviewed implementation and evidence. Authentication and actual scheduled worker completion are proven.
- [ ] Stock/popularity observations are fresh and feeds/storefront behave correctly during stale/unavailable cases. Optional monitor URL, secret and incident recipient are verified.

## Checkout and fulfillment

- [ ] Stripe sandbox account/key and signed snapshot webhook are verified on this deployment with the pinned API version and three required Checkout events.
- [ ] Stripe public business/support details, statement descriptor and **Successful payments**/**Refunds** receipt settings match the owner's decisions in the intended account/environment. Record an actually received receipt separately from its enabled setting; follow [Stripe identity and receipts](store-setup.md#customer-receipts-and-public-business-details).
- [ ] Through the store: single/multiple item shipping, invalid/unavailable variants, Checkout open/cancel/return and a complete sandbox payment work.
- [ ] The test order is durably simulated and event replay does not duplicate it; Printify has no new test-generated order.
- [ ] Tax configuration matches the owner's choices; disabled tax means no tax collection. Provider account checks do not establish all legal obligations.
- [ ] Printify uses Manual approval with a merchant payment method/balance ready for authorized fulfillment.
- [ ] The intended Printify shop's label name (at most 30 characters, no emoji) and owner-approved ship-from/return handling are reviewed. Record the actual shipment label and received tracking email as verified or pending: sender/display name, Reply-To, brand, order and tracking link. Follow [shop identity and tracking](store-setup.md#shop-identity-return-address-and-tracking-emails); an API notification flag is not email-branding or delivery evidence, and this check does not authorize a purchase.
- [ ] Optional real purchase has explicit scope/budget and independently verified payment, one provider order, exact items/address and production state. Otherwise mark it pending or not applicable with reason; do not manufacture one to tick a box.
- [ ] Physical sample and delivery evidence are verified or clearly pending for the owner's launch decision.

## Channels and operations

- [ ] Provider token issue/expiry dates, the next rotation date and the rotation owner are recorded without token values. In particular, Printify personal access tokens expire after one year; verify the configured credentials' actual dates and the owner's reminder/handoff rather than assuming a new token renewed every environment.
- [ ] Review deployment-specific WAF rate limits for `POST /api/checkout` and `GET /api/checkout/status`, spend alerts and repeated **Checkout fulfillment needs retry** alerts using [checkout operational controls](checkout-resilience.md#launch-checks-and-remaining-operational-limits). Record actual configured controls, thresholds and the responding owner, or an explicit blocker. Signed payment webhooks must remain outside anonymous-checkout challenges/rate rules.
- [ ] If merchant channels are in scope, intended feeds authenticate, import correct variant IDs/images/prices and match website shipping/returns. Ownership, claim, import and listing approval are recorded separately.
- [ ] Optional Meta/Google marketing has this store's own destinations, reviewed consent/account settings and authorized activation. Denial, withdrawal, GPC and private/checkout URL protections pass isolated tests.
- [ ] Actual page/purchase receipt is recorded separately from an Active tag or successful configuration response. Stripe remains the revenue ledger.
- [ ] Support ownership, payment/webhook failures and uncertain-order recovery are assigned. Optional shipping reminders have a verified sender, schedule and real recipient receipt; customer correspondence remains a separate action.

## Code and release

- [ ] `pnpm check` passes. Full local/CI integration requirements pass before merge; any unavailable suite is explicit and cannot count as passed.
- [ ] `pnpm check:template` passes for template changes. `pnpm setup:check --sandbox` passed before the sandbox journey and `pnpm setup:check --launch` passes for the configured store; this is a configuration gate only.
- [ ] The exact authorized production revision, origin and environment are read back after deployment. Normal Git integration may trigger deployment: account for that before pushing or merging.
- [ ] Live activation and product-publication actions remain within actual owner instructions. Reuse authority already given; ask only for a concrete uncovered decision.

## Repository security and merge gate

Prepare the intended repository's settings for the owner, then verify the saved non-secret state after any authorized changes. GitHub's official paths were checked **2026-09-28**:

1. Open **Settings → Security and quality → Advanced Security**. Confirm [Dependabot alerts and automatic security updates](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/configure-security-updates), then [Secret Protection/secret scanning](https://docs.github.com/en/code-security/how-tos/secure-your-secrets/detect-secret-leaks/enable-secret-scanning) and its separate [Push protection](https://docs.github.com/en/code-security/how-tos/secure-your-secrets/prevent-future-leaks/enable-push-protection) setting. Record unavailable or disabled features explicitly; private-repository Secret Protection depends on the repository's ownership and licensed plan. Do not purchase an upgrade without the owner's authorization.
2. Under **Settings**, open **Rulesets** and select the active default-branch ruleset, or **Branches** for an existing classic branch-protection rule. Require status checks before merging and add the exact **Required checks** context once that workflow is present. Save and read back the target branch, enforcement state, required context and applicable bypasses. [GitHub's ruleset guide](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository) and [branch-protection documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches) describe the controls; private repositories need Pro, Team or Enterprise for these branch rules. If the workflow or plan is unavailable, leave the item blocked rather than claiming enforcement.

## Remaining limits

- **Existing owner accounts need separate review.** The [first-owner fix](admin-auth.md#owner-enrollment-guarantee) applies to new enrollment. Use the [read-only claim inspection](admin-auth.md#updating-an-installation-and-inspecting-an-older-claim) to distinguish unclaimed, reserved and older/dashboard claims. Neither the migration nor a green setup check repairs ownership established by older code; use [provider-led recovery](admin-auth.md#setup-recovery) if credentials or account origin are uncertain.
- **`deps-2` includes remote settings.** Secret scanning and push protection that remain off are unresolved settings, even when local checks and Dependabot pass. Report each as enabled, disabled or unavailable for this repository, with its owner and next action; template files do not establish their remote state.

Return a short receipt with storefront/admin URLs, verified results, pending external checks, and the next owner action if one is required. A store may have working checkout while sample delivery or a merchant channel is pending; state those facts separately rather than collapsing everything into “launched.”
