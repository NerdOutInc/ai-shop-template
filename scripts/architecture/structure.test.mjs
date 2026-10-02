import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { checkStructure } from "../check-structure.mjs"

function fixture(t, filenames) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "store-structure-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  for (const filename of filenames) {
    const target = path.join(root, filename)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, "")
  }
  return root
}

test("allows the agreed source layout and real Next conventions without git tracking", (t) => {
  const root = fixture(t, [
    "src/app/layout.tsx",
    "src/app/page.tsx",
    "src/app/globals.css",
    "src/app/(shop)/products/[slug]/page.tsx",
    "src/app/(shop)/products/[slug]/_components/product-info.tsx",
    "src/app/(shop)/products/[slug]/_components/product-info.test.tsx",
    "src/app/(shop)/products/[slug]/_components/product-info.stories.tsx",
    "src/app/@modal/(.)photo/page.tsx",
    "src/app/docs/[[...slug]]/page.tsx",
    "src/app/files/[...path]/page.tsx",
    "src/app/opengraph-image.tsx",
    "src/app/opengraph-image.alt.txt",
    "src/app/favicon.ico",
    "src/proxy.ts",
    "src/features/catalog/get-product.server.ts",
    "src/features/catalog/get-product.server.test.ts",
    "src/features/catalog/product-card.module.css",
    "src/lib/catalog.d.ts",
    "e2e/shop.spec.ts",
    "test/setup.ts",
    ".storybook/main.ts",
    ".storybook/vitest.setup.ts",
    "scripts/artwork/anything.py",
    ".agents/skills/Anything/Example.ts",
  ])
  assert.deepEqual(checkStructure(root), [])
})

test("rejects misplaced, badly named, orphaned, and barrel source files", (t) => {
  const root = fixture(t, [
    "components/card.tsx",
    "src/utils.ts",
    "src/services/shop.ts",
    "src/features/checkout.ts",
    "src/features/catalog/ProductCard.tsx",
    "src/features/catalog/index.ts",
    "src/features/catalog/missing.test.ts",
    "src/app/products/data.ts",
    "src/app/_components/BadCard.tsx",
    "src/features/catalog/browse.spec.ts",
    "test/cart.test.ts",
  ])
  const errors = checkStructure(root)
  for (const prefix of [
    "components/card.tsx:",
    "src/utils.ts:",
    "src/services/shop.ts:",
    "src/features/checkout.ts:",
    "src/features/catalog/ProductCard.tsx:",
    "src/features/catalog/index.ts:",
    "src/features/catalog/missing.test.ts:",
    "src/app/products/data.ts:",
    "src/app/_components/BadCard.tsx:",
    "src/features/catalog/browse.spec.ts:",
    "test/cart.test.ts:",
  ])
    assert.ok(
      errors.some((error) => error.startsWith(prefix)),
      `${prefix} should fail`
    )
})

test("route syntax is allowed only in app and source symlinks cannot bypass placement", (t) => {
  const root = fixture(t, ["src/features/[catalog]/product.ts", "src/app/[BadSlug]/page.tsx"])
  fs.symlinkSync(path.join(root, "src/features"), path.join(root, "src/lib"))
  const errors = checkStructure(root)
  assert.ok(errors.some((error) => error.startsWith("src/features/[catalog]:")))
  assert.ok(errors.some((error) => error.startsWith("src/app/[BadSlug]:")))
  assert.ok(errors.some((error) => error.includes("source symlinks")))
})

test("root-only conventions stay at app root while route components accept TypeScript without JSX", (t) => {
  const root = fixture(t, [
    "src/app/robots.ts",
    "src/app/manifest.ts",
    "src/app/global-error.tsx",
    "src/app/global-not-found.tsx",
    "src/app/shop/page.ts",
    "src/app/shop/layout.ts",
  ])
  assert.deepEqual(checkStructure(root), [])
  for (const name of ["robots.ts", "manifest.ts", "global-error.tsx", "global-not-found.tsx"]) {
    fs.writeFileSync(path.join(root, "src/app/shop", name), "")
  }
  const errors = checkStructure(root)
  for (const name of ["robots.ts", "manifest.ts", "global-error.tsx", "global-not-found.tsx"]) {
    assert.ok(
      errors.some((error) => error.startsWith(`src/app/shop/${name}:`)),
      name
    )
  }
})

test("metadata placement accepts numbered images and TSX while root-only metadata remains restricted", (t) => {
  const root = fixture(t, [
    "src/app/robots.tsx",
    "src/app/manifest.tsx",
    "src/app/shop/sitemap.tsx",
    "src/app/shop/icon1.tsx",
    "src/app/shop/icon2.ts",
    "src/app/shop/apple-icon1.tsx",
    "src/app/shop/opengraph-image1.tsx",
    "src/app/shop/twitter-image2.tsx",
    "src/app/api/data/route.tsx",
  ])
  assert.deepEqual(checkStructure(root), [])
  for (const name of ["robots.tsx", "manifest.tsx", "icon10.tsx"])
    fs.writeFileSync(path.join(root, "src/app/shop", name), "")
  const errors = checkStructure(root)
  for (const name of ["robots.tsx", "manifest.tsx", "icon10.tsx"])
    assert.ok(
      errors.some((error) => error.startsWith(`src/app/shop/${name}:`)),
      name
    )
})

test("ignored root output and asset names cannot hide source files in nested directories", (t) => {
  const root = fixture(t, [
    "assets/print/OriginalArtwork.ts",
    "output/GeneratedFile.ts",
    ".tmp/GeneratedFile.ts",
    ".turbo/GeneratedFile.ts",
    "src/features/catalog/assets/ProductCard.jsx",
    "src/components/dist/index.ts",
    "src/node_modules/widget.ts",
    "test/output/BadFixture.js",
    "e2e/.next/BadSpec.js",
  ])
  const errors = checkStructure(root)
  for (const prefix of [
    "src/features/catalog/assets/ProductCard.jsx:",
    "src/components/dist/index.ts:",
    "src/node_modules/widget.ts:",
    "test/output/BadFixture.js:",
    "e2e/.next/BadSpec.js:",
  ])
    assert.ok(
      errors.some((error) => error.startsWith(prefix)),
      `${prefix} should fail`
    )
  assert.ok(errors.every((error) => /^(?:src|test|e2e)\//.test(error)))
})

test("the commerce tool config is a narrow root exception", (t) => {
  const root = fixture(t, ["vitest.commerce.config.ts", "vitest.other.config.ts", "commerce.ts"])
  const errors = checkStructure(root)
  assert.ok(!errors.some((error) => error.startsWith("vitest.commerce.config.ts:")))
  assert.ok(errors.some((error) => error.startsWith("vitest.other.config.ts:")))
  assert.ok(errors.some((error) => error.startsWith("commerce.ts:")))
})
