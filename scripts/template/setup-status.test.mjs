import assert from "node:assert/strict"
import test from "node:test"
import { setupStatus } from "./setup-status.mjs"

test("fresh stores have actionable pending steps and never print supplied credentials", () => {
  const config = {
    configured: false,
    id: "your-store",
    name: "Your Store",
    supportEmail: "support@example.com",
    commerce: { shippingConfirmed: false },
    policies: { published: false },
  }
  const checks = setupStatus(config, { STRIPE_SECRET_KEY: "rk_test_secret-sentinel" })
  assert.ok(checks.every((check) => !check.ready && check.next))
  assert.ok(!JSON.stringify(checks).includes("secret-sentinel"))
})

test("an example domain and unconfirmed shipping cannot count as launch configuration", () => {
  const checks = setupStatus(
    {
      configured: true,
      id: "new-brand",
      name: "New Brand",
      supportEmail: "hello@newbrand.test",
      commerce: { shippingConfirmed: false },
      policies: { published: true },
    },
    {
      NEXT_PUBLIC_SITE_URL: "https://example.com",
      STRIPE_SECRET_KEY: "rk_test_fixture",
      STRIPE_WEBHOOK_SECRET: "whsec_fixture",
    }
  )
  assert.equal(checks.find((check) => check.name === "Canonical domain").ready, false)
  assert.equal(checks.find((check) => check.name === "Shipping and policies").ready, false)
  assert.equal(checks.find((check) => check.name === "Stripe payments").ready, true)
})

test("owner sign-in requires the server-side Supabase key", () => {
  const config = { commerce: {}, policies: {}, supportEmail: "hello@example.com" }
  const environment = {
    ADMIN_LIBRARY_ENABLED: "true",
    NEXT_PUBLIC_SUPABASE_URL: "https://new-store.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-fixture",
    PRIVATE_BLOB_READ_WRITE_TOKEN: "private-fixture",
    ADMIN_OWNER_EMAIL: "owner@example.com",
  }
  const owner = (env) =>
    setupStatus(config, env).find((check) => check.name === "Owner sign-in and private artwork").ready
  assert.equal(owner(environment), false)
  assert.equal(owner({ ...environment, SUPABASE_SECRET_KEY: "server-fixture" }), true)
})
