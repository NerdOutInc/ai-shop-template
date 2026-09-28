# Template origin

This application starts from [Blazity's Next.js Enterprise Boilerplate](https://github.com/Blazity/next-enterprise), selected from the [Vercel template directory](https://vercel.com/templates/next.js/nextjs-enterprise-boilerplate).

The imported baseline is commit [`97c4f3ed6be0a5b255d0e71606c7b355138281a9`](https://github.com/Blazity/next-enterprise/tree/97c4f3ed6be0a5b255d0e71606c7b355138281a9). Its MIT license is retained in the repository root.

The foundation adapts its strict TypeScript configuration, formatting, Tailwind/PostCSS setup, environment validation, and testing approach. Application code moves into `src/`; Next.js uses Turbopack, and Storybook uses the Next.js Vite framework. Configuration and dependency versions are maintained in this repository rather than following the template automatically.

The promotional application, health aliases, mandatory commit hooks, release automation, contributor tools, dependency graphs, OpenTelemetry, Radix packages, patch hooks, Webpack bundle analysis, and external test-reporting integrations are omitted. Dependabot replaces Renovate.

The Button and Tooltip primitives use the official shadcn Base UI implementations, generated with the `base-nova` preset. Base UI is the selected component foundation for future additions. Their `cn` imports point to the local implementation configured in `components.json`; the neutral theme is configured centrally and can be replaced with the new owner's approved direction.

Storybook's current Vitest add-on supports Vitest 3 and 4. Keep the Vitest packages on the same compatible version until the add-on supports the next major; do not force incompatible peer dependencies.

For occasional local bundle inspection, use `pnpm exec next experimental-analyze`. This Next.js tool is experimental and is not part of required CI.
