# Template origin

This template was extracted from an owner-controlled storefront and generalized for new stores. The [provenance record](template-provenance.json) records source and template commit/tree identifiers without a source repository address, account details, credentials, artwork, or imported Git history. It is a record of derivation, not an automatic update connection.

Run the [template hygiene checks](template-hygiene.md) when distributing or personalizing a copy, and preserve the provenance and license notices.

The initial export commit is inferred as `dced8c485df97cfa420ff8961978af6ce836c876`, based on the creation-session record that current main was exported and the source commit chronology. The exact archive command was not recovered. The later garment-description change from source commit `b32ab30dd7c74f3d17cb88b9dbf4111224cafe54` was incorporated before the first template publication; its merge and inclusion are confirmed by the contemporaneous creation record and source history. These are separate evidence claims, not a claim that today's source HEAD was exported.

The published starting baseline is template commit `d498dd3fb8b0e1c84b980b9cf35a42007ec7e04f`, following the initial import commit `3379d7b8daec011d168d2ae866b56fdf1e15d035` and its local mail-configuration fix. The template begins with fresh store data and independent history. Its source identifiers are for maintainers investigating an intentional port; generated stores do not inherit the source store's accounts, operational state, or compatibility obligations.

This application starts from [Blazity's Next.js Enterprise Boilerplate](https://github.com/Blazity/next-enterprise), selected from the [Vercel template directory](https://vercel.com/templates/next.js/nextjs-enterprise-boilerplate).

The imported foundation baseline is commit [`97c4f3ed6be0a5b255d0e71606c7b355138281a9`](https://github.com/Blazity/next-enterprise/tree/97c4f3ed6be0a5b255d0e71606c7b355138281a9). Its copyright notice and MIT text are retained unchanged in the repository root. Preserve that upstream notice when personalizing or distributing a generated store.

The copyright holder and any additional licensing notice for the store-specific and template-specific additions remain an explicit owner decision. This extraction has no recorded assignment establishing either the company or a collective contributor label as that holder. No new ownership assertion is added to `LICENSE`; repository visibility and Git authorship do not settle that decision.

The foundation adapts its strict TypeScript configuration, formatting, Tailwind/PostCSS setup, environment validation, and testing approach. Application code moves into `src/`; Next.js uses Turbopack, and Storybook uses the Next.js Vite framework. Configuration and dependency versions are maintained in this repository rather than following the template automatically.

The promotional application, health aliases, mandatory commit hooks, release automation, contributor tools, dependency graphs, OpenTelemetry, Radix packages, patch hooks, Webpack bundle analysis, and external test-reporting integrations are omitted. Dependabot replaces Renovate.

The Button and Tooltip primitives use the official shadcn Base UI implementations, generated with the `base-nova` preset. Base UI is the selected component foundation for future additions. Their `cn` imports point to the local implementation configured in `components.json`; the neutral theme is configured centrally and can be replaced with the new owner's approved direction.

Storybook's current Vitest add-on supports Vitest 3 and 4. Keep the Vitest packages on the same compatible version until the add-on supports the next major; do not force incompatible peer dependencies.

For occasional local bundle inspection, use `pnpm exec next experimental-analyze`. This Next.js tool is experimental and is not part of required CI.
