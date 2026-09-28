# Architecture and source conventions

This guide expands the mandatory rules in [AGENTS.md](../AGENTS.md). Start with the nearest owner of a responsibility, and share code when another real consumer needs it. A shop coming soon does not need an empty shopping mall of folders.

## Folder ownership

Paths below are relative to the repository root. They describe where code belongs when needed; they are not a list of directories to scaffold immediately.

| Location                  | Responsibility                                                          |
| ------------------------- | ----------------------------------------------------------------------- |
| `src/app/`                | Next.js routing, page composition, metadata, and global styles          |
| `src/app/**/_components/` | Presentation owned by that route segment and its descendants            |
| `src/features/<feature>/` | Feature-owned components, behavior, hooks, types, and server code       |
| `src/components/`         | Application UI used by multiple owners                                  |
| `src/components/ui/`      | Official shadcn Base UI primitives                                      |
| `src/hooks/`              | Hooks with demonstrated use across features                             |
| `src/lib/`                | Shared utilities and infrastructure                                     |
| `public/`                 | Assets deliberately served by the website                               |
| `assets/print/`           | README-only pointer to private artwork and production storage           |
| `scripts/artwork/`        | Existing Python artwork tools                                           |
| `test/`                   | Shared test setup, fixtures, and support; never production dependencies |
| `e2e/`                    | Browser journeys and their support                                      |

Use the official shadcn **Base UI** variants with the `base-nova` preset in `components.json`. Keep future primitives on this foundation; introducing Radix is a stack change that must be discussed first.

Keep tool configuration, `.storybook/`, documentation, and maintenance scripts at the repository root. Framework entrypoints may also live directly in `src/` when required: `proxy.ts`, `instrumentation.ts`, `instrumentation-client.ts`, and `mdx-components.tsx`. Do not create them until they have a job.

Keep a new feature flat:

```text
src/features/catalog/
  product-card.tsx
  product-card.test.tsx
  product-card.stories.tsx
  format-product-price.ts
```

Add a subfolder when distinct responsibilities make that feature difficult to navigate. Keep code owned by one feature inside it, including its hooks and types. Move it to a shared location only when another actual consumer needs the same responsibility; similar-looking code is not sufficient evidence of the same abstraction. Prefer domain names such as `format-product-price.ts` over catchall files like `helpers.ts`.

Keep route files focused on framework responsibilities and composition. A route can compose feature components and its own presentation. For example, `src/app/shop/_components/shop-intro.tsx` belongs to `shop`: the shop page and descendants such as `shop/[slug]/page.tsx` may import it, but `src/app/about/page.tsx` may not. Move genuinely shared presentation to its proper shared owner rather than reaching into a sibling's private folder.

## Names and colocation

| Item                              | Convention                               | Example                                  |
| --------------------------------- | ---------------------------------------- | ---------------------------------------- |
| Ordinary source files and folders | Kebab-case                               | `product-card.tsx`, `calculate-total.ts` |
| React components and types        | PascalCase                               | `ProductCard`, `ProductCardProps`        |
| Functions and variables           | camelCase                                | `calculateTotal`, `productCount`         |
| React hooks                       | `use` prefix                             | `useCart` in `use-cart.ts`               |
| Unit/component tests              | Beside implementation, `.test` suffix    | `product-card.test.tsx`                  |
| Component stories                 | Beside implementation, `.stories` suffix | `product-card.stories.tsx`               |
| Browser journeys                  | In `e2e/`, `.spec.ts` suffix             | `e2e/home.spec.ts`                       |
| Environment-specific modules      | Optional `.server` or `.client` suffix   | `read-product.server.ts`                 |
| Type declarations                 | `.d.ts` suffix                           | `external-service.d.ts`                  |

The permitted source role suffixes are `.test`, `.stories`, `.server`, `.client`, and `.d`. Environment suffixes may precede a colocated test/story suffix: `read-product.server.test.ts` tests `read-product.server.ts`. A file containing only types still uses a descriptive kebab-case name; no `.types` suffix is needed.

Preserve actual [Next.js file and routing conventions](https://nextjs.org/docs/app/getting-started/project-structure), including files such as `page.tsx`, `layout.tsx`, `route.ts`, and `not-found.tsx`, metadata files, dynamic segments (`[slug]`, `[...slug]`, `[[...slug]]`), route groups (`(shop)`), parallel/intercepted routes, and private folders (`_components`). A reserved-looking filename outside the location where Next.js recognizes it is an ordinary source file, not an exception.

Tests and stories must have a neighboring implementation with the matching basename. Shared setup and reusable fixtures belong in `test/`; browser-specific support belongs in `e2e/`. Keep runtime application imports independent of both.

## Export one runtime unit

An ordinary source module exports one component, function, class, or value. Related type exports and private helpers can remain beside that unit. A module that contains only types may export several related types. Function overload signatures describe the same runtime function and do not count as additional units.

```tsx
export type ProductCardProps = {
  name: string
}

export function ProductCard({ name }: ProductCardProps) {
  return <article>{name}</article>
}
```

Use named exports defined in their owning module. Split a second exported runtime responsibility into its own file; do not split private helpers or associated types merely to increase the file count. Do not create `index.ts` barrels, `export *` collections, or an import followed by re-export of that imported implementation. Import the owning module directly.

The exceptions are narrow:

| Exception                             | What it permits                                                                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Actual Next.js convention files       | Framework-required default exports and multiple framework exports, such as a page with metadata or a route with HTTP handlers |
| Tool configuration and entrypoints    | Exports required by that tool's configuration API                                                                             |
| Colocated Storybook stories           | Default story metadata and multiple named stories                                                                             |
| `src/components/ui/button.tsx`        | The official primitive's component/variant export shape                                                                       |
| `src/components/ui/tooltip.tsx`       | The official primitive's related component export shape                                                                       |
| `src/components/ui/carousel.tsx`      | The official primitive's related component and hook export shape                                                              |
| `src/components/ui/alert.tsx`         | The official primitive's related component export shape                                                                       |
| `src/components/ui/badge.tsx`         | The official primitive's component/variant export shape                                                                       |
| `src/components/ui/empty.tsx`         | The official primitive's related component export shape                                                                       |
| `src/components/ui/field.tsx`         | The official primitive's related component export shape                                                                       |
| `src/components/ui/native-select.tsx` | The official primitive's related component export shape                                                                       |
| `src/components/ui/toggle-group.tsx`  | The official primitive's related component export shape                                                                       |
| `src/components/ui/toggle.tsx`        | The official primitive's component/variant export shape                                                                       |
| `src/components/ui/dialog.tsx`        | The official primitive's related component export shape                                                                       |
| `src/components/ui/dropdown-menu.tsx` | The official primitive's related component export shape                                                                       |

These exceptions do not waive import boundaries, production/test separation, or naming rules for neighboring application code. Adding another official shadcn primitive requires identifying its exact path in the enforcement allowlist and this table; do not exempt the whole `ui/` directory. Propose a convention change before broadening an exception beyond its existing purpose.

## Dependency directions and import paths

The same layer restrictions apply to runtime imports and type-only imports.

| Importer                              | May import                                            |
| ------------------------------------- | ----------------------------------------------------- |
| Routes and their private presentation | Features, shared code, and permitted route-local code |
| Features                              | Other features and shared code                        |
| Shared components                     | Shared components, hooks, and utilities               |
| Shared hooks                          | Shared hooks and utilities                            |
| Shared utilities                      | Shared utilities                                      |

Use relative paths inside a feature or local unit, and the `@/` alias across areas. Import from the owning module, not a barrel:

```tsx
// Within src/features/catalog/product-card.tsx:
import { formatProductPrice } from "./format-product-price"
import { Button } from "@/components/ui/button"
```

Features may depend directly on other features when the responsibility calls for it, but no runtime dependency cycle is allowed. Type-only cycles are permitted; they do not permit a shared utility to depend on a feature. Prefer `import type` for type-only dependencies so the graph reflects their actual role.

Production modules cannot import unit tests, stories, shared test setup/fixtures, or browser-test support. Tests and stories may import the production module they exercise and appropriate test support. Using a relative path instead of `@/` cannot bypass an ownership restriction.

Dynamic application imports must use a string literal, for example `import("./product-dialog")`; computed paths and template strings are prohibited. They follow the same resolution, ownership, and runtime-cycle checks as static imports. This keeps lazy-loading dependencies visible to the checks.

## Server and client boundaries

Prefer Server Components for composition and noninteractive content. Put `"use client"` at the smallest useful interactive boundary. Keep server-only implementation within its feature unless real reuse justifies shared infrastructure in `src/lib/`.

Import `"server-only"` in modules that must never enter the client bundle, including code that reads secrets or uses privileged service credentials. A filename such as `read-product.server.ts` communicates intent but does not enforce it. Do not expose secrets through client environment variables or serialize them into component props.

## Artwork and public assets

`public/` is for files the website intentionally serves. It is not a storage location for print masters, production metadata, or unused artwork. Preserve the source/upload distinction documented in [assets/print/README.md](../assets/print/README.md) and follow the [Printify workflow](printify-workflow.md) for shirt work.

The existing Python tools in `scripts/artwork/` keep their established naming and file format conventions. Web source organization checks exclude those tools, print assets, installed skills, dependencies, and generated output.

## Enforcement and verification

`package.json` and the tool configurations are authoritative for runnable commands and versions:

| Command                  | Purpose                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `pnpm check:structure`   | Check placement, names, suffixes, and test/story colocation, including new untracked files                 |
| `pnpm check:migrations`  | Check literal migration filenames and relative migration links against local files without applying SQL    |
| `pnpm lint`              | Check source quality, resolved imports, ownership, exports, production/test separation, and runtime cycles |
| `pnpm typecheck`         | Check application and tooling types                                                                        |
| `pnpm format:check`      | Check formatting without rewriting files                                                                   |
| `pnpm test:unit`         | Run unit/component behavior tests                                                                          |
| `pnpm test:stories`      | Run Storybook browser tests                                                                                |
| `pnpm test:architecture` | Verify valid and invalid enforcement fixtures                                                              |
| `pnpm test:e2e`          | Run browser journeys                                                                                       |
| `pnpm build`             | Build the production app                                                                                   |
| `pnpm build-storybook`   | Build the component workbench                                                                              |
| `pnpm check`             | Run structure, migration references, lint, types, formatting, unit tests, and architecture tests           |
| `pnpm check:all`         | Run all baseline checks, browser stories, both builds, and browser journeys                                |

When changing conventions or enforcement, include fixtures that demonstrate the intended acceptance and rejection. Preserve coverage of alias and relative imports, route-private ownership, type-only dependencies, static and dynamic cycles, overloads, associated type exports, framework filenames, and narrowly scoped exceptions. Fix the underlying issue rather than adding broad ignores or disabling a rule to clear CI.

Browser verification remains necessary for UI changes: check narrow and wide layouts, keyboard navigation, visible focus, and changed interactions. A successful build does not establish that those interactions work. Full CI must pass before merge; report skipped or unavailable checks explicitly.
