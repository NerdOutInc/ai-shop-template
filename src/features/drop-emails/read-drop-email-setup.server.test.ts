import { beforeEach, describe, expect, it, vi } from "vitest"

import { readDropEmailSetup } from "./read-drop-email-setup.server"

const { settings, store } = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  store: {
    name: "Fixture Store",
    configured: true,
    policies: { published: true },
    features: { designOfTheWeek: true, dropSignup: true },
    privacy: { retainedDropSubscribers: false, retainedDropEmailRecords: true },
  },
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/env", () => ({ env: settings }))
vi.mock("@/lib/store-config", () => ({ storeConfig: store }))

const complete = {
  DATABASE_URL: "postgres://fixture",
  NEXT_PUBLIC_SITE_URL: "https://store.example",
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
  store.privacy.retainedDropEmailRecords = true
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

  // Its links, and the one-click unsubscribe header, would otherwise fall back to localhost.
  it("needs the store's own https address before any link can go out", () => {
    for (const address of [undefined, "http://store.example"]) {
      settings.NEXT_PUBLIC_SITE_URL = address
      expect(readDropEmailSetup()).toMatchObject({ missing: ["NEXT_PUBLIC_SITE_URL"], sending: false })
    }
  })

  // The switch that keeps Privacy describing delivery records after a pause has to be on first.
  it("waits for the delivery-record disclosure before the first send", () => {
    store.privacy.retainedDropEmailRecords = false
    expect(readDropEmailSetup()).toMatchObject({ storeSettings: ["privacy.retainedDropEmailRecords"], sending: false })
  })

  it("keeps mailing a closed list that kept its subscribers", () => {
    store.features.dropSignup = false
    store.privacy.retainedDropSubscribers = true
    expect(readDropEmailSetup()).toMatchObject({ storeSettings: [], sending: true })
  })
})
