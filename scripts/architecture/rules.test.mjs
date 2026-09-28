import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { ESLint } from "eslint"
import { createArchitectureConfig } from "./eslint-config.mjs"

async function lint(t, files) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "store-rules-")))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        jsx: "preserve",
        paths: { "@/*": ["./src/*"] },
      },
    })
  )
  for (const [filename, content] of Object.entries(files)) {
    const target = path.join(root, filename)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
  const eslint = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: [createArchitectureConfig(root)] })
  const results = await eslint.lintFiles(Object.keys(files))
  return Object.fromEntries(results.map((result) => [path.relative(root, result.filePath), result.messages]))
}

function has(results, file, rule, messageId) {
  return results[file].some((message) => message.ruleId === rule && (!messageId || message.messageId === messageId))
}

test("browser tests use fixture configuration through every import form", async (t) => {
  const results = await lint(t, {
    "src/lib/store-config.ts": "export const storeConfig = { name: 'Merchant' }",
    "test/store-config.ts": "export const storeConfig = { name: 'Fixture Store' }",
    "e2e/alias.spec.ts": "import { storeConfig } from '@/lib/store-config'; void storeConfig",
    "e2e/relative.spec.ts": "import { storeConfig } from '../src/lib/store-config'; void storeConfig",
    "e2e/nested/extension.spec.ts": "import { storeConfig } from '../../src/lib/store-config.ts'; void storeConfig",
    "e2e/dynamic.spec.ts": "void import('@/lib/store-config')",
    "e2e/fixture.spec.ts": "import { storeConfig } from '../test/store-config'; void storeConfig",
    "src/lib/consumer.ts": "import { storeConfig } from './store-config'; export const name = storeConfig.name",
  })
  for (const name of ["alias", "relative", "nested/extension", "dynamic"])
    assert.ok(has(results, `e2e/${name}.spec.ts`, "architecture/imports", "merchantConfig"), name)
  assert.deepEqual(results["e2e/fixture.spec.ts"], [])
  assert.deepEqual(results["src/lib/consumer.ts"], [])
})

test("allows shared dependencies and direct acyclic feature imports with local relative imports", async (t) => {
  const results = await lint(t, {
    "src/lib/format-price.ts": "export const formatPrice = (n: number) => String(n)",
    "src/features/catalog/product.ts": "export type Product = { price: number }; export const product = { price: 4 }",
    "src/features/catalog/get-price.ts":
      "import { product } from './product'; export const getPrice = () => product.price",
    "src/features/cart/subtotal.ts":
      "import { getPrice } from '@/features/catalog/get-price'; import { formatPrice } from '@/lib/format-price'; export const subtotal = () => formatPrice(getPrice())",
  })
  assert.deepEqual(Object.values(results).flat(), [])
})

test("resolved layer rules reject alias, relative, dynamic, and type imports equally", async (t) => {
  const results = await lint(t, {
    "src/features/catalog/product.ts": "export type Product = { price: number }; export const product = { price: 4 }",
    "src/lib/alias.ts": "import { product } from '@/features/catalog/product'; export const result = product",
    "src/lib/relative.ts": "import { product } from '../features/catalog/product'; export const result = product",
    "src/lib/dynamic.ts": "export const load = () => import('@/features/catalog/product')",
    "src/lib/dynamic-relative.ts": "export const load = () => import('../features/catalog/product')",
    "src/lib/types.ts": "import type { Product } from '@/features/catalog/product'; export type Item = Product",
    "src/lib/inline-type.ts": "export type Item = import('@/features/catalog/product').Product",
  })
  for (const name of ["alias", "relative", "dynamic", "dynamic-relative", "types", "inline-type"])
    assert.ok(has(results, `src/lib/${name}.ts`, "architecture/imports", "layer"), name)
})

test("route-local privacy uses resolved paths including route groups and dynamic segments", async (t) => {
  const results = await lint(t, {
    "src/app/(shop)/products/[slug]/_components/product-info.ts": "export const info = 1",
    "src/app/(shop)/products/[slug]/page.tsx":
      "import { info } from './_components/product-info'; export default function Page() { return info }",
    "src/app/(shop)/products/[slug]/reviews/page.tsx":
      "import { info } from '@/app/(shop)/products/[slug]/_components/product-info'; export default function Page() { return info }",
    "src/app/(shop)/cart/page.tsx":
      "import { info } from '@/app/(shop)/products/[slug]/_components/product-info'; export default function Page() { return info }",
    "src/app/(shop)/checkout/page.tsx":
      "export default async function Page() { return import('../products/[slug]/_components/product-info') }",
  })
  assert.deepEqual(results["src/app/(shop)/products/[slug]/page.tsx"], [])
  assert.deepEqual(results["src/app/(shop)/products/[slug]/reviews/page.tsx"], [])
  assert.ok(has(results, "src/app/(shop)/cart/page.tsx", "architecture/imports", "private"))
  assert.ok(has(results, "src/app/(shop)/checkout/page.tsx", "architecture/imports", "private"))
})

test("reports runtime cycles through aliases, relative imports, and literal dynamic imports", async (t) => {
  for (const style of ["alias", "relative", "dynamic"]) {
    const first =
      style === "alias"
        ? "import { b } from '@/features/b/b'; export const a = () => b()"
        : style === "relative"
          ? "import { b } from '../b/b'; export const a = () => b()"
          : "export const a = () => import('@/features/b/b')"
    const results = await lint(t, {
      "src/features/a/a.ts": first,
      "src/features/b/b.ts": "import { a } from '@/features/a/a'; export const b = () => a()",
    })
    assert.ok(
      Object.values(results)
        .flat()
        .some((message) => message.ruleId === "import-x/no-cycle"),
      style
    )
  }
})

test("type-only cycles remain allowed and computed dynamic imports cannot hide runtime dependencies", async (t) => {
  const results = await lint(t, {
    "src/features/a/a.ts": "import type { B } from '@/features/b/b'; export type A = { b?: B }",
    "src/features/b/b.ts": "import type { A } from '@/features/a/a'; export type B = { a?: A }",
    "src/features/c/computed.ts": "const modulePath = './other'; export const load = () => import(modulePath)",
    "src/features/c/template.ts": "export const load = () => import(`./other`)",
  })
  assert.deepEqual(results["src/features/a/a.ts"], [])
  assert.deepEqual(results["src/features/b/b.ts"], [])
  assert.ok(has(results, "src/features/c/computed.ts", "architecture/imports", "literal"))
  assert.ok(has(results, "src/features/c/template.ts", "architecture/imports", "literal"))
})

test("enforces local relative and cross-unit alias imports and prevents production test dependencies", async (t) => {
  const results = await lint(t, {
    "src/features/a/value.ts": "export const value = 1",
    "src/features/a/local.ts": "import { value } from '@/features/a/value'; export const local = value",
    "src/features/b/cross.ts": "import { value } from '../a/value'; export const cross = value",
    "src/features/a/value.test.ts": "export const fixture = 1",
    "src/features/a/from-test.ts": "import { fixture } from './value.test'; export const value = fixture",
    "src/features/a/missing.ts": "import { x } from './missing-file'; export const missing = x",
  })
  assert.ok(has(results, "src/features/a/local.ts", "architecture/imports", "relative"))
  assert.ok(has(results, "src/features/b/cross.ts", "architecture/imports", "alias"))
  assert.ok(has(results, "src/features/a/from-test.ts", "architecture/imports", "development"))
  assert.ok(has(results, "src/features/a/missing.ts", "import-x/no-unresolved"))
})

test("colocated tests and stories may use shared test support without exposing it to production", async (t) => {
  const results = await lint(t, {
    "test/fixture.ts": "export const fixture = 1",
    "scripts/fixture.ts": "export const fixture = 1",
    "src/features/a/card.test.ts": "import { fixture } from '../../../test/fixture'; export const check = fixture",
    "src/features/a/card.stories.ts": "import { fixture } from '../../../test/fixture'; export const Example = fixture",
    "src/features/a/card.ts": "import { fixture } from '../../../test/fixture'; export const card = fixture",
    "src/features/a/tool.test.ts": "import { fixture } from '../../../scripts/fixture'; export const check = fixture",
  })
  assert.deepEqual(results["src/features/a/card.test.ts"], [])
  assert.deepEqual(results["src/features/a/card.stories.ts"], [])
  assert.ok(has(results, "src/features/a/card.ts", "architecture/imports", "development"))
  assert.ok(has(results, "src/features/a/card.ts", "architecture/imports", "outside"))
  assert.ok(has(results, "src/features/a/tool.test.ts", "architecture/imports", "outside"))
})

test("one runtime binding permits types and overloads but rejects destructured or aliased extra exports", async (t) => {
  const results = await lint(t, {
    "src/lib/valid.ts":
      "export type Input = string; export interface Options { n: number }; export function parse(x: string): string; export function parse(x: number): string; export function parse(x: string | number) { return String(x) }",
    "src/lib/invalid.ts": "export const first = 1, second = 2",
    "src/lib/destructure.ts": "export const { first, second } = { first: 1, second: 2 }",
    "src/lib/aliases.ts": "const a = 1; const b = 2; export { a, b }",
    "src/lib/merged.ts": "type Option = string; const Option = 'yes'; const second = 2; export { Option, second }",
    "src/lib/type-aliases.ts": "type Input = string; const parse = () => ''; export { Input, parse }",
    "src/lib/default.ts": "export default function run() {}",
    "src/lib/barrel.ts": "export { parse } from './valid'",
    "src/lib/hidden-barrel.ts": "import { parse } from './valid'; export { parse }",
    "src/lib/type-barrel.ts": "export type { Input } from './valid'",
    "src/lib/hidden-type-barrel.ts": "import type { Input } from './valid'; export type { Input }",
  })
  assert.deepEqual(results["src/lib/valid.ts"], [])
  assert.deepEqual(results["src/lib/type-aliases.ts"], [])
  for (const name of ["invalid", "destructure", "aliases", "merged"])
    assert.ok(has(results, `src/lib/${name}.ts`, "architecture/exports", "multiple"), name)
  assert.ok(has(results, "src/lib/default.ts", "architecture/exports", "default"))
  for (const name of ["barrel", "hidden-barrel", "type-barrel", "hidden-type-barrel"])
    assert.ok(has(results, `src/lib/${name}.ts`, "architecture/exports", "barrel"), name)
})

test("framework, stories and exact primitive exceptions do not exempt ordinary neighbors", async (t) => {
  const galleryPrimitives = [
    "alert",
    "badge",
    "empty",
    "field",
    "native-select",
    "toggle-group",
    "toggle",
    "dialog",
    "dropdown-menu",
  ]
  const results = await lint(t, {
    ...Object.fromEntries(
      galleryPrimitives.map((name) => [
        `src/components/ui/${name}.tsx`,
        "export const First = () => null; export const Second = () => null",
      ])
    ),
    "src/app/page.tsx": "export const metadata = {}; export default function Page() { return null }",
    "src/app/api/health/route.ts": "export const GET = () => 1; export const POST = () => 2",
    "src/app/_components/card.tsx": "export const Card = () => null; export const Other = () => null",
    "src/components/ui/button.tsx": "export const Button = () => null; export const buttonVariants = {}",
    "src/components/ui/tooltip.tsx": "export const Tooltip = () => null; export const TooltipTrigger = () => null",
    "src/components/ui/carousel.tsx": "export const Carousel = () => null; export const CarouselItem = () => null",
    "src/components/ui/custom.tsx": "export const First = () => null; export const Second = () => null",
    "src/components/ui/button.stories.tsx": "export default {}; export const Default = {}; export const Disabled = {}",
    ".storybook/main.ts": "export default {}",
  })
  for (const name of [
    ...galleryPrimitives.map((name) => `src/components/ui/${name}.tsx`),
    "src/app/page.tsx",
    "src/app/api/health/route.ts",
    "src/components/ui/button.tsx",
    "src/components/ui/tooltip.tsx",
    "src/components/ui/carousel.tsx",
    "src/components/ui/button.stories.tsx",
    ".storybook/main.ts",
  ])
    assert.deepEqual(results[name], [], name)
  assert.ok(has(results, "src/app/_components/card.tsx", "architecture/exports", "multiple"))
  assert.ok(has(results, "src/components/ui/custom.tsx", "architecture/exports", "multiple"))
})

test("quoted default export aliases follow the same default-export restriction", async (t) => {
  const results = await lint(t, {
    "src/lib/value.ts": 'const value = 1; export { value as "default" }',
    "src/app/page.ts": 'const Page = () => null; export { Page as "default" }',
  })
  assert.ok(has(results, "src/lib/value.ts", "architecture/exports", "default"))
  assert.deepEqual(results["src/app/page.ts"], [])
})

test("root-only convention names cannot exempt exports in nested route segments", async (t) => {
  const files = {}
  const conventionNames = [
    "robots.ts",
    "robots.tsx",
    "manifest.ts",
    "manifest.tsx",
    "global-error.tsx",
    "global-not-found.tsx",
  ]
  for (const name of conventionNames) {
    files[`src/app/${name}`] = "export const first = 1; export const second = 2; export default function Run() {}"
    files[`src/app/shop/${name}`] = files[`src/app/${name}`]
  }
  files["src/app/shop/page.ts"] = "export const metadata = {}; export default function Page() { return null }"
  files["src/app/shop/layout.ts"] = "export const metadata = {}; export default function Layout() { return null }"
  const results = await lint(t, files)
  for (const name of conventionNames) {
    assert.deepEqual(results[`src/app/${name}`], [], name)
    assert.ok(has(results, `src/app/shop/${name}`, "architecture/exports", "default"), name)
    assert.ok(has(results, `src/app/shop/${name}`, "architecture/exports", "multiple"), name)
  }
  assert.deepEqual(results["src/app/shop/page.ts"], [])
  assert.deepEqual(results["src/app/shop/layout.ts"], [])
})

test("metadata export exceptions accept Next numbered image files and both TypeScript extensions", async (t) => {
  const files = {}
  const names = [
    "icon1.tsx",
    "icon2.ts",
    "apple-icon1.tsx",
    "opengraph-image1.tsx",
    "twitter-image2.tsx",
    "sitemap.tsx",
  ]
  for (const name of names)
    files[`src/app/shop/${name}`] = "export const first = 1; export const second = 2; export default function Run() {}"
  files["src/app/shop/icon10.tsx"] = "export const first = 1; export const second = 2; export default function Run() {}"
  const results = await lint(t, files)
  for (const name of names) assert.deepEqual(results[`src/app/shop/${name}`], [], name)
  assert.ok(has(results, "src/app/shop/icon10.tsx", "architecture/exports", "default"))
})
