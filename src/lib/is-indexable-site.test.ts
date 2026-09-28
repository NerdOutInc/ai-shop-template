import { beforeEach, describe, expect, it, vi } from "vitest"

import { isIndexableSite } from "./is-indexable-site"

vi.mock("server-only", () => ({}))
const config = vi.hoisted(() => ({
  NODE_ENV: "production",
  VERCEL_ENV: undefined as string | undefined,
  NEXT_PUBLIC_SITE_URL: "https://store.example" as string | undefined,
}))
const store = vi.hoisted(() => ({
  configured: true,
  policies: { published: true },
  commerce: { shippingConfirmed: true },
}))
vi.mock("./env", () => ({ env: config }))
vi.mock("./store-config", () => ({ storeConfig: store }))

beforeEach(() => {
  config.NODE_ENV = "production"
  config.VERCEL_ENV = undefined
  config.NEXT_PUBLIC_SITE_URL = "https://store.example"
  store.configured = true
  store.policies.published = true
  store.commerce.shippingConfirmed = true
})

describe("search indexing environment", () => {
  it.each([
    ["production", "production", true],
    ["production", undefined, true],
    ["production", "preview", false],
    ["production", "development", false],
    ["development", undefined, false],
    ["test", undefined, false],
  ])("handles %s builds on %s", (nodeEnv, vercelEnv, expected) => {
    config.NODE_ENV = nodeEnv
    config.VERCEL_ENV = vercelEnv
    expect(isIndexableSite()).toBe(expected)
  })

  it("keeps a copied template out of search even on production hosting", () => {
    store.configured = false
    expect(isIndexableSite()).toBe(false)
  })

  it("requires approved policies and an explicit canonical domain", () => {
    store.policies.published = false
    expect(isIndexableSite()).toBe(false)
    store.policies.published = true
    config.NEXT_PUBLIC_SITE_URL = undefined
    expect(isIndexableSite()).toBe(false)
  })
})

it("does not expose merchant feeds before shipping is approved", () => {
  store.commerce.shippingConfirmed = false
  expect(isIndexableSite()).toBe(false)
})
