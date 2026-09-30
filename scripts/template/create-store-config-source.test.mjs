import assert from "node:assert/strict"
import { test } from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"

import { createStoreConfigSource } from "../../e2e/create-store-config-source.ts"
import { configuredStoreConfig } from "../../test/configured-store-config.ts"

function executeValues(source) {
  const result = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  })
  assert.deepEqual(result.diagnostics, [])
  const exports = {}
  runInNewContext(result.outputText, { exports })
  return JSON.parse(JSON.stringify(exports.storeConfigValues))
}

test("replaces only owner data, preserves directives/types/comments, and emits no runtime imports", () => {
  const before = `"use strict"\nimport type { StoreConfigInput } from "./store-config-schema"\n// Keep the owner's declaration.\nexport const storeConfigValues = `
  const after = ` satisfies StoreConfigInput\nexport type OwnerConfig = typeof storeConfigValues\n`
  const generated = createStoreConfigSource(`${before}{ name: "Replace me" }${after}`, configuredStoreConfig)
  assert.ok(generated.startsWith(before))
  assert.ok(generated.endsWith(after))
  assert.ok(!generated.includes("Replace me"))
  assert.deepEqual(executeValues(generated), configuredStoreConfig)
})

test("does not confuse nested declarations or a string with the exported data", () => {
  const source = `const text = "export const storeConfigValues ="\nfunction example() { const storeConfigValues = "leave me"; return storeConfigValues }\nexport const storeConfigValues = {}\n`
  const generated = createStoreConfigSource(source, configuredStoreConfig)
  assert.ok(generated.includes('const storeConfigValues = "leave me"'))
  assert.deepEqual(executeValues(generated), configuredStoreConfig)
})

test("rejects invalid fixtures through the production schema", () => {
  assert.throws(
    () =>
      createStoreConfigSource("export const storeConfigValues = {}", {
        ...configuredStoreConfig,
        weeklyFeature: { weekday: 7, hour: 24, minute: 60 },
      }),
    { name: "ZodError" }
  )
})

for (const source of [
  "const storeConfigValues = {}",
  "export let storeConfigValues = {}",
  "export const anotherConfig = {}",
  "export const storeConfigValues: unknown",
  "export const storeConfigValues = {}; export const storeConfigValues = {}",
]) {
  test(`rejects an absent or ambiguous target: ${source}`, () => {
    assert.throws(
      () => createStoreConfigSource(source, configuredStoreConfig),
      /exactly one exported const storeConfigValues/
    )
  })
}
