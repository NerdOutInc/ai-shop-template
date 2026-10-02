import assert from "node:assert/strict"
import { test } from "node:test"
import { selectChangedTests } from "./select-changed-tests.mjs"
import { resolveCommerceTestScope } from "../../test/resolve-commerce-test-scope.ts"

const examples = [
  "src/app/_components/design-of-the-week.test.tsx",
  "src/app/admin/products/emails/page.test.tsx",
  "src/features/drop-signup/drop-confirmation-panel.stories.tsx",
  "src/features/subscribers/subscriber-manager.stories.tsx",
  "e2e/admin/subscribers.spec.ts",
  "e2e/design-of-the-week.spec.ts",
]

test("every omitted test identified by the review is selected in its owning suite", () => {
  const selection = selectChangedTests(examples)
  assert.deepEqual(Object.values(selection).flat().sort(), examples.toSorted())
  assert.ok(resolveCommerceTestScope({ CI_TEST_SELECTION: JSON.stringify(selection) }).files.includes(examples[0]))
})

test("changed implementations select their colocated tests and stories, without duplicating commerce browsers", () => {
  const paths = new Set([
    "src/features/sample/card.tsx",
    "src/features/sample/card.test.tsx",
    "src/features/sample/card.stories.tsx",
    "e2e/commerce/storefront.spec.ts",
  ])
  const selection = selectChangedTests([...paths], (file) => paths.has(file))
  assert.deepEqual(selection.unit, ["src/features/sample/card.test.tsx"])
  assert.deepEqual(selection.stories, ["src/features/sample/card.stories.tsx"])
  assert.deepEqual(selection.public, [])
  assert.deepEqual(selectChangedTests(["src/removed.test.ts"], () => false).unit, [])
  assert.throws(() => selectChangedTests(["src/../escape.test.ts"], () => true), /Unsafe/)
})

test("new database-backed changed tests require their exact disposable database too", () => {
  const selected = resolveCommerceTestScope({
    CI_TEST_SELECTION: JSON.stringify({
      unit: ["src/features/catalog-sync/postgres-catalog-sync-store.server.test.ts"],
    }),
  })
  assert.equal(selected.databases.CATALOG_TEST_DATABASE_URL, "store_catalog_test")
  assert.throws(
    () => resolveCommerceTestScope({ CI_TEST_SELECTION: JSON.stringify({ unit: ["../escape.test.ts"] }) }),
    /Invalid/
  )
})
