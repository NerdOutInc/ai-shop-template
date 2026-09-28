# Metadata during client navigation

Keep canonical URLs and search/social metadata in the Next.js Metadata API. The shared configuration disables metadata streaming with `htmlLimitedBots: /.*/` so initial head hydration finishes with the route, before a fast client navigation can abandon it. Canonicals should travel light: one destination, one tag.

Next 16.3.6 needs the pinned `patches/next@16.3.6.patch` for static pages to honor this setting. Its export configuration reads `.source` from a value already normalized to a string, losing the setting, and its export worker unconditionally enables streaming. The patch passes the normalized value through and honors the exact `/.*/` opt-out for non-PPR prerenders.

The runtime patch applies that same opt-out when a page regenerates without a User-Agent. Vercel's revalidation header allowlist omits User-Agent, and the store routinely invalidates the root layout after publishing, visibility and schedule changes, and backfills. Without the runtime fix, regeneration replaces the correct build output with streaming metadata and brings back the duplicate tags. Both CommonJS and ESM build/runtime files receive the same changes. Static routes remain prerendered; request-dependent routes still render dynamically.

Without the fix, immediate homepage navigation to About or Returns leaves the server-rendered homepage canonical alongside the destination canonical. Cart retains the homepage canonical despite declaring none. The duplicate survives after navigation settles. This is consistent with the initial-head hydration report in [Next issue #97472](https://github.com/vercel/next.js/issues/97472#issuecomment-5653284177). Changing individual route declarations or adding an empty `<head>` does not address it.

## Verification and upkeep

`e2e/canonical-navigation.spec.ts` first regenerates About and Returns without a User-Agent, requiring a `REVALIDATED` response from the local production server. Home renders the weekly catalog dynamically, so it is not an ISR target. The tests retain both fast Home → About/Returns transitions and also start from regenerated About when navigating to Returns or the no-canonical Cart route. They click real links after DOMContentLoaded, confirm the same document survives, and check singleton canonical/title/description metadata, including Back/Forward. The configured projects cover desktop Chromium, mobile Chromium, and desktop WebKit; Chromium runs with 4× CPU throttling to keep the hydration window observable. `e2e/seo.spec.ts` additionally covers dynamic product navigation and existing direct-entry, query-string, missing/withheld-product, and utility-page metadata. The About suite protects inherited social tags and the share image with JavaScript disabled.

Run those specs against a fresh production build and the isolated catalog fixture. Check pristine-build navigation separately before starting the regeneration suite, which deliberately replaces cached artifacts. Do not add an idle wait before the first click: it can hide the original failure.

Every Next upgrade must update the exact `pnpm.patchedDependencies` key and patch filename as well as the dependency and lockfile. pnpm deliberately rejects an unused version-pinned patch with `ERR_PNPM_UNUSED_PATCH`; a Dependabot update, including its grouped dependency PR, therefore needs this manual step. Rebase the patch against the new package, run `pnpm install --frozen-lockfile`, rebuild, and run the browser coverage. Reproduce without the patch before deciding to remove it. Do not silence unused-patch errors or drop the patch merely to make an upgrade install.

## Limits and remaining edges

- Blocking metadata can delay the initial response of dynamic pages until `generateMetadata` resolves. It does not disable page-content streaming or make all routes dynamic. See the [Next streaming opt-out documentation](https://nextjs.org/docs/app/api-reference/config/next-config-js/htmlLimitedBots).
- The patch intentionally leaves PPR/cache-components prerendering unchanged. Enabling those features requires revisiting this workaround.
- Local production tests cover header-less on-demand regeneration, including the cached response served to subsequent browsers. They do not establish behavior on Vercel itself or its cold prefetch cache; those deployment-specific paths remain to be checked.
