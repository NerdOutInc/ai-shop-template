import { beforeEach, describe, expect, it, vi } from "vitest"

import { readDropEmailSetup } from "./read-drop-email-setup.server"

const { settings, store } = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  store: {
    name: "Fixture Store",
    configured: true,
    policies: { published: true },
    features: { designOfTheWeek: true, dropSignup: true },
    privacy: { retainedDropSubscribers: false },
  },
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/env", () => ({ env: settings }))
vi.mock("@/lib/store-config", () => ({ storeConfig: store }))

const complete = {
  DATABASE_URL: "postgres://fixture",
  PRINTIFY_SHOP_ID: "123",
  PRINTIFY_PUBLISHING_ENABLED: true,
  RESEND_API_KEY: "re_fixture",
  DROP_EMAIL_FROM_EMAIL: "drops@fixture.example",
  STORE_POSTAL_ADDRESS: "PO Box 123, Austin, TX 78701",
  CRON_SECRET: "c".repeat(32),
  DROP_EMAILS_ENABLED: "true",
  VERCEL_ENV: "production",
}

beforeEach(() => {
  for (const key of Object.keys(settings)) delete settings[key]
  Object.assign(settings, complete)
  store.configured = true
  store.policies.published = true
  store.features.designOfTheWeek = true
  store.features.dropSignup = true
  store.privacy.retainedDropSubscribers = false
})

describe("readDropEmailSetup", () => {
  it("sends only when switched on, in production, with everything it needs", () => {
    expect(readDropEmailSetup()).toEqual({
      missing: [],
      storeSettings: [],
      sending: true,
      from: "Fixture Store <drops@fixture.example>",
      postalAddress: "PO Box 123, Austin, TX 78701",
    })
    settings.VERCEL_ENV = "preview"
    expect(readDropEmailSetup().sending).toBe(false)
    settings.VERCEL_ENV = "production"
    settings.DROP_EMAILS_ENABLED = "false"
    expect(readDropEmailSetup().sending).toBe(false)
  })

  // A marketing email without a postal address breaks US law, so its absence alone keeps sending off.
  it("names every missing setting, and a missing mailing address stops the sender", () => {
    delete settings.STORE_POSTAL_ADDRESS
    settings.PRINTIFY_PUBLISHING_ENABLED = false
    expect(readDropEmailSetup()).toMatchObject({
      missing: ["PRINTIFY_PUBLISHING_ENABLED", "STORE_POSTAL_ADDRESS"],
      sending: false,
      postalAddress: null,
    })
  })

  // Privacy describes these emails only beside the list, and drops only exist with the weekly feature.
  it("waits for a configured store with published policies, the weekly feature and a list", () => {
    store.configured = false
    store.policies.published = false
    store.features.designOfTheWeek = false
    store.features.dropSignup = false
    expect(readDropEmailSetup()).toMatchObject({
      missing: [],
      storeSettings: ["configured", "policies.published", "features.designOfTheWeek", "features.dropSignup"],
      sending: false,
    })
  })

  it("keeps mailing a closed list that kept its subscribers", () => {
    store.features.dropSignup = false
    store.privacy.retainedDropSubscribers = true
    expect(readDropEmailSetup()).toMatchObject({ storeSettings: [], sending: true })
  })
})
