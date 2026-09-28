---
name: store-google-merchant
description: Set up or troubleshoot Google Merchant Center for this Printify storefront, including account onboarding, domain verification and claiming, the scheduled product feed, crawler access, and product approval checks.
---

# Connect the store to Google Merchant Center

Carry setup through a verified import and an honest account of product approval. A successful file fetch, a verified domain, and approved listings are separate milestones. The shirts need to pass more than one route check.

Read the [store setup](../../../docs/store-setup.md) for the actual shipping, payment, and fulfillment behavior. Read [feed implementation and failure handling](references/feed-contract.md) when configuring the source, diagnosing its responses, or adapting the store to another brand. Check current official Google documentation when operating the account; menus and requirements change.

## Establish the intended account and business facts

Use the [confirmed store defaults](../store-template-readiness/references/store-defaults.md) and relevant [owner intake](../store-owner-handoff/references/owner-intake.md) inputs. Each store has its own domain, provider resources and Blob storage. Start with the supported Next Level 6210 profile; pricing, shipping and business policy come from this owner. New product publication should flow into the existing scheduled feed automatically, without per-product code changes or manual feed reconstruction.

Inspect existing Merchant Center accounts, data sources, Search Console properties, and the production deployment before creating replacements. Use current source and account state to verify anything carried forward from a prior task. Do not assume an implementation, deployment, or unfinished task is complete.

Resolve these inputs from the repository, the intended account, and prior authorized answers; ask only for material facts still missing:

- Intended business/brand and Google account, production HTTPS origin, Merchant Center account, and domain administrator.
- Selling country, language, currency, and refresh timezone; legal/business information and customer support contacts.
- Actual shipping coverage, charges, handling/transit commitments, and returns policy that agree with the storefront and checkout.
- Garment/product category, audience, sizing system, and whether the finished products have assigned GTINs or manufacturer part numbers.

Use the user's existing authenticated browser for account setup. Reuse the existing account/source when it serves the requested store. Show any required terms or consequential changes in concrete form and follow the authorization already present in the conversation. Do not reuse another brand's address, account IDs, tokens, DNS records, or policy choices. Keep private information out of skill files, journals, command output, and screenshots intended for handoff.

## Verify ownership, claim the website, and submit the sitemap

1. Confirm the exact production origin and intended Merchant account. Complete the account's business and online-store information using verified facts.
2. Inspect existing ownership. A Search Console **Domain property** covers the domain's protocols and subdomains and uses DNS verification. A **URL-prefix property** covers its stated protocol/host/path prefix. Choose the property needed for the task; do not substitute one for the other without accounting for that scope.
3. If DNS verification is needed, obtain the current token from the intended property, prepare the exact record in the correct zone, and preserve existing records. After an authorized change, verify the record through public DNS and Google's verification result. Do not remove the verification record after success.
4. Return to Merchant Center and confirm both **verified** and **claimed** status. Search Console ownership by a Merchant account user can satisfy verification; claiming associates the site with that Merchant account. Do not take over an existing claim merely to clear an error.
5. Submit the production sitemap only after its deployed URL returns a complete valid sitemap. Check the sitemap processing report separately from an HTTP fetch or a successful live URL test. A submission acknowledgment is not successful processing or indexing.

For a user-only step, leave the correct tab open, state the exact action and completion signal, then resume and read back the result. Example: “Sign in to your domain provider in this tab and open this domain's DNS records. I can then add the prepared verification record and check it in Google.” User login does not establish that verification succeeded.

Sources: [Search Console property types and ownership](https://support.google.com/webmasters/answer/9008080?hl=en), [Merchant website verification and claiming](https://support.google.com/merchants/answer/11586344?hl=en), [business information](https://support.google.com/merchants/answer/14286818?hl=en).

## Activate the scheduled feed

Use the published storefront feed unless the requested cadence or destination requires a different integration. A direct Google API integration is not required for this daily-file workflow.

1. Check the deployed `/feeds/google` implementation and production configuration. Configure a dedicated random `GOOGLE_MERCHANT_FEED_PASSWORD` through the authorized secret-management workflow. The current username is `google-merchant`. `/feeds/meta` separately requires `META_CATALOG_FEED_PASSWORD` and username `meta-catalog`; neither endpoint falls back to the other's credentials. Keep passwords out of URLs, repository files, and logs.
2. Verify that the deployment serving the feed has the configured secret. An environment edit alone does not prove the running deployment uses it. Confirm an authorized request returns complete XML with the expected catalog; verify anonymous access is unavailable.
3. In Merchant Center, inspect **Settings → Data sources**, then create or edit the file source. Enter the production feed URL and credentials in its authentication fields. Set the requested country, language, daily schedule, and named timezone. Read back the saved configuration; do not infer the timezone from an unlabeled time.
4. Trigger a first fetch. Check the processing timestamp, item count, recognized attributes, and file errors. Compare the count with the size/color variants of the products actually on the wall -- not the number of designs, and not everything published, because the feed carries only products the reveal gate shows. Sample exact variant IDs, selected landing URLs, prices, stock, and matching photos.
5. Check automatic price and availability updates. They supplement scheduled imports, so page markup must agree with the feed and checkout eligibility.

For Meta activation, configure its separate password and verify the authorized deployment before creating the Commerce Manager feed source with `/feeds/meta` and its own authentication. Reuse an existing source only when it already belongs to this store and environment. Follow the [Meta import acceptance checklist](references/feed-contract.md#meta-import-acceptance); local XML/unit/browser checks do not prove provider import. Rotate each destination's password with its corresponding source authentication.

Sources: [scheduled file sources and authentication](https://support.google.com/merchants/answer/12158380?hl=en), [automatic updates](https://support.google.com/merchants/answer/12157888?hl=en), [product data specification](https://support.google.com/merchants/answer/7052112?hl=en).

## Diagnose approval and image crawling

Inspect **Products → Needs attention** and sampled product details after processing. Distinguish file errors, account/policy issues, landing-page failures, image failures, and products still under review. Correct the data source or publication snapshot so the fix survives the next refresh; inspect manual product overrides if Google disagrees with the submitted data.

For a crawler warning, inspect the exact URL Google identifies and each host involved:

- Fetch the production landing page and inspect robots directives, redirects, access protection, canonical URL, and matching selected variant.
- Fetch the feed's actual `image_link`, including redirects, and inspect **that image host's** robots rules for Googlebot and Googlebot-image. An image visible in a browser or through Next.js optimization does not prove Google can fetch its submitted source URL.
- Check every feed image URL from an unauthenticated crawler context. Verify the actual image host’s behavior. Changing the storefront's robots.txt cannot unblock another host.
- Blob hosting is implemented in image publication. Use [Blob image operations](../store-publishing-recovery/references/product-images.md) to verify the fresh database baseline, storage binding, build-time hostname and deployment. Repair saved images with the bounded frozen-snapshot backfill; republishing current drafts can release unrelated edits. The feed can still return 200 with unhosted Printify URLs, so check its actual image URLs and public objects. A dry-run hosted count does not verify object existence. Preserve artwork, color associations, image order, and the last published snapshot if copying fails.

Shopping images show the finished garment and correct color, not just the transparent print-design PNG. Use supported image formats and current dimension requirements; preserve existing AI-origin metadata. Keep URLs stable for unchanged images and use new URLs for changed content. Do not invent identifiers or automatically set `identifier_exists=no` for every print-on-demand product; apply the current category requirements to the actual finished product.

Refresh the source after a verified fix and check Google's diagnostics again. Crawling, processing, and review can lag; request a review only after correcting the relevant issue. An approved listing is eligible to show, not proof of impressions or sales.

Sources: [image and crawler requirements](https://support.google.com/merchants/answer/6324350?hl=en), [variant grouping](https://support.google.com/merchants/answer/6324507?hl=en), [identifier rules](https://support.google.com/merchants/answer/6324478?hl=en), [product visibility and approval](https://support.google.com/merchants/answer/12488713?hl=en), [reviewing corrected issues](https://support.google.com/merchants/answer/13585221?hl=en).

## Report completion precisely

Record the account/source links, production feed URL, schedule/timezone, latest successful import time and counts, and any outstanding diagnostic categories. State separately whether website verification, claiming, sitemap processing, feed import, image crawling, and product approval are confirmed or pending. Do not include credentials or private business details.

If ongoing refresh was part of the request, verify a later scheduled fetch when available. Otherwise label it configured but not yet observed. Set up a follow-up only when the user asks to monitor or check later, with notifications for meaningful changes or required action rather than unchanged review status.
