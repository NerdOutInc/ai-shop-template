import assert from "node:assert/strict"
import { test } from "node:test"

import { storeConfigSchema } from "../../src/lib/store-config-schema.ts"
import { storeConfig as merchantConfig } from "../../src/lib/store-config.ts"
import { configuredStoreConfig } from "../../test/configured-store-config.ts"
import { storeConfig as fixtureConfig } from "../../test/store-config.ts"

// These run under Node, outside Vitest's fixture resolver, so owner edits still
// exercise the production module and its real schema on every baseline check.
test("the merchant's actual configuration passes the shared schema", () => {
  assert.deepEqual(storeConfigSchema.parse(merchantConfig), merchantConfig)
  assert.notEqual(merchantConfig, fixtureConfig)
})

test("both fixed test configurations pass the production schema", () => {
  assert.deepEqual(storeConfigSchema.parse(fixtureConfig), fixtureConfig)
  assert.deepEqual(storeConfigSchema.parse(configuredStoreConfig), configuredStoreConfig)
  assert.equal(fixtureConfig.configured, false)
  assert.equal(fixtureConfig.policies.published, false)
  assert.equal(fixtureConfig.commerce.shippingConfirmed, false)
  assert.equal(configuredStoreConfig.configured, true)
  assert.equal(configuredStoreConfig.policies.published, true)
  assert.equal(configuredStoreConfig.commerce.shippingConfirmed, true)
})

test("the fixed test configuration cannot bypass production validation", () => {
  assert.throws(() =>
    storeConfigSchema.parse({ ...fixtureConfig, weeklyFeature: { weekday: 7, hour: 25, minute: 60 } })
  )
  assert.throws(() => storeConfigSchema.parse({ ...configuredStoreConfig, supportEmail: "support@example.com" }))
})

test("the prior owner-data snapshot loads without losing customization or activating omitted features", async () => {
  const { readFileSync } = await import("node:fs")
  const prior = JSON.parse(readFileSync(new URL("./fixtures/prior-store-config.json", import.meta.url), "utf8"))
  assert.deepEqual(storeConfigSchema.parse(prior), prior)
  const { features, ...withoutFeatures } = prior
  assert.deepEqual(storeConfigSchema.parse(withoutFeatures), {
    ...withoutFeatures,
    features: { designOfTheWeek: false, dropSignup: false, about: false },
  })
  assert.deepEqual(storeConfigSchema.parse({ ...prior, features: { about: features.about } }).features, {
    designOfTheWeek: false,
    dropSignup: false,
    about: features.about,
  })
})

test("retained-data disclosures and payment identity need explicit store decisions", () => {
  for (const key of ["retainedDropSubscribers", "retainedDropEmailRecords"]) {
    const privacy = { ...configuredStoreConfig.privacy, retainedDropSubscribers: true, retainedDropEmailRecords: true }
    assert.deepEqual(storeConfigSchema.parse({ ...configuredStoreConfig, privacy }).privacy, privacy)
    delete privacy[key]
    assert.throws(() => storeConfigSchema.parse({ ...configuredStoreConfig, privacy }))
  }
  const { identity, ...commerce } = configuredStoreConfig.commerce
  assert.ok(identity)
  assert.throws(() => storeConfigSchema.parse({ ...configuredStoreConfig, commerce }))
})
