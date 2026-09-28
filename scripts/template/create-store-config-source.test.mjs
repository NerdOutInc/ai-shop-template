import assert from "node:assert/strict"
import { test } from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"

import { createStoreConfigSource } from "../../e2e/create-store-config-source.ts"
import { storeConfigSchema } from "../../src/lib/store-config-schema.ts"
import { configuredStoreConfig } from "../../test/configured-store-config.ts"

function executeConfig(source) {
  const result = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  })
  assert.deepEqual(result.diagnostics, [])
  const exports = {}
  runInNewContext(result.outputText, {
    exports,
    require: (name) => {
      assert.equal(name, "./store-config-schema")
      return { storeConfigSchema }
    },
  })
  return exports.storeConfig
}

test("replaces the initializer while preserving annotations, imports, and associated exported types", () => {
  const before = `"use strict"\nimport { storeConfigSchema as ownerSchema } from "./store-config-schema"\nimport type { z } from "zod"\n// Keep the owner's declaration shape.\nexport const storeConfig: z.infer<typeof ownerSchema> = `
  const after = `\n// Consumers import this associated type.\nexport type StoreConfig = typeof storeConfig\n`
  const source = `${before}ownerSchema.parse({ name: "Merchant data must be replaced" })${after}`
  const generated = createStoreConfigSource(source, configuredStoreConfig)

  const originalDeclarations = generated.replace(
    '\nimport { storeConfigSchema as fixtureStoreConfigSchema } from "./store-config-schema"\n',
    ""
  )
  assert.ok(originalDeclarations.startsWith(before))
  assert.ok(generated.startsWith('"use strict"'))
  assert.ok(generated.includes(after))
  assert.ok(!generated.includes("Merchant data must be replaced"))
  assert.deepEqual(executeConfig(generated), configuredStoreConfig)
})

test("does not confuse a string or nested declaration with the exported configuration", () => {
  const source = `import { storeConfigSchema } from "./store-config-schema"\nconst text = "export const storeConfig ="\nfunction example() { const storeConfig = "leave this alone"; return storeConfig }\nexport const storeConfig = storeConfigSchema.parse({})\nexport type StoreConfig = typeof storeConfig\n`
  const generated = createStoreConfigSource(source, configuredStoreConfig)

  assert.ok(generated.includes('const text = "export const storeConfig ="'))
  assert.ok(generated.includes('const storeConfig = "leave this alone"'))
  assert.deepEqual(executeConfig(generated), configuredStoreConfig)
})

test("chooses a schema import alias that does not collide with owner identifiers", () => {
  const source = `import { storeConfigSchema } from "./store-config-schema"\nconst fixtureStoreConfigSchema = "reserved"\ntype fixtureStoreConfigSchema2 = string\nexport const storeConfig = storeConfigSchema.parse({})\n`
  const generated = createStoreConfigSource(source, configuredStoreConfig)

  assert.ok(generated.includes("storeConfigSchema as fixtureStoreConfigSchema3"))
  assert.deepEqual(executeConfig(generated), configuredStoreConfig)
})

test("rejects malformed fixture data through the real production schema", () => {
  assert.throws(
    () =>
      createStoreConfigSource("export const storeConfig = {}", {
        ...configuredStoreConfig,
        weeklyFeature: { weekday: 7, hour: 24, minute: 60 },
      }),
    { name: "ZodError" }
  )
})

for (const source of [
  "const storeConfig = {}",
  "export let storeConfig = {}",
  "export const anotherConfig = {}",
  "export const storeConfig: unknown",
  "export const storeConfig = {}; export const storeConfig = {}",
]) {
  test(`rejects an absent or ambiguous target: ${source}`, () => {
    assert.throws(
      () => createStoreConfigSource(source, configuredStoreConfig),
      /exactly one exported const storeConfig/
    )
  })
}
