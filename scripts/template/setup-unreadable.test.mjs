import assert from "node:assert/strict"
import test from "node:test"

import { storeConfig } from "../../src/lib/store-config.ts"
import { setupStatus } from "./setup-status.mjs"

const config = {
  ...storeConfig,
  configured: true,
  id: "unreadable-fixture",
  name: "Unreadable Fixture",
  shortName: "Fixture",
  description: "Illustrated shirts for everyday outings.",
  tagline: "Wear your imagination.",
  supportEmail: "hello@fixturebrand.com",
  features: { ...storeConfig.features, about: false },
  home: {
    ...storeConfig.home,
    headline: "Illustrations to wear.",
    introduction: "Explore the illustrated collection.",
  },
  commerce: { ...storeConfig.commerce, identity: "unreadable-fixture", shippingConfirmed: true },
  policies: {
    published: true,
    shippingText: ["Contact us for delivery questions."],
    returnsText: ["Contact us to arrange a return."],
    privacyText: ["We use order details for fulfillment."],
  },
}
const environment = {
  NEXT_PUBLIC_SITE_URL: "https://fixturebrand.com",
  DATABASE_URL:
    "postgresql://store_app_runtime.project:synthetic-password@aws-0.pooler.supabase.com:5432/postgres?sslmode=verify-full",
  DATABASE_SSL_CA: "-----BEGIN CERTIFICATE-----\nU1lOVEhFVElDLUNBLUZJWFRVUkU=\n-----END CERTIFICATE-----",
  PRINTIFY_PUBLISHING_ENABLED: "true",
  PRINTIFY_FULFILLMENT_ENABLED: "true",
  PRINTIFY_API_TOKEN: "a".repeat(64),
  PRINTIFY_PUBLISHING_API_TOKEN: "b".repeat(64),
  PRINTIFY_SHOP_ID: "1234567",
  PRINTIFY_WEBHOOK_SECRET: "c".repeat(32),
  CRON_SECRET: "d".repeat(32),
  NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST: "fixturebrand.public.blob.vercel-storage.com",
  BLOB_READ_WRITE_TOKEN: "e".repeat(64),
  CHECKOUT_RATE_LIMIT_SECRET: "f".repeat(32),
  STRIPE_SECRET_KEY: `rk_live_${"g".repeat(64)}`,
  STRIPE_WEBHOOK_SECRET: `whsec_${"h".repeat(32)}`,
}
const options = {
  mode: "launch",
  setupState: { decisions: { printifyBlueprintId: 1317, printifyPrintProviderId: 99 } },
  schedules: [
    { path: "/api/internal/printify-publishing", schedule: "* * * * *" },
    { path: "/api/internal/catalog-sync/stock", schedule: "*/30 * * * *" },
    { path: "/api/internal/catalog-sync/popularity", schedule: "0 */6 * * *" },
  ],
}
const status = (overrides = {}, unreadableKeys = []) =>
  setupStatus(config, { ...environment, ...overrides }, { ...options, unreadableKeys })
const check = (name, checks) => checks.find((item) => item.name === name)

test("a raw sensitive marker is never configured without the explicit export unreadable option", () => {
  for (const key of [
    "PRINTIFY_API_TOKEN",
    "PRINTIFY_PUBLISHING_API_TOKEN",
    "PRINTIFY_DRAFTS_API_TOKEN",
    "BLOB_READ_WRITE_TOKEN",
    "SUPABASE_SECRET_KEY",
    "PRIVATE_BLOB_READ_WRITE_TOKEN",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ]) {
    const checks = status({ [key]: "[SENSITIVE]" })
    assert.ok(
      checks.some((item) => !item.ready),
      key
    )
    assert.ok(!checks.some((item) => item.unreadable), key)
  }
})

test("hiding only the database URL does not waive malformed readable CA content", () => {
  for (const marker of ["", "[SENSITIVE]"]) {
    for (const certificate of [
      " ",
      "\t",
      "not-a-certificate",
      "-----BEGIN CERTIFICATE-----\n-----END CERTIFICATE-----",
    ]) {
      const database = check(
        "Database",
        status({ DATABASE_URL: marker, DATABASE_SSL_CA: certificate }, ["DATABASE_URL"])
      )
      assert.equal(database.ready, false)
    }
  }
})

test("hidden database values remain unreadable without inventing a mandatory CA for an unknown host", () => {
  for (const marker of ["", "[SENSITIVE]"]) {
    for (const certificate of [undefined, environment.DATABASE_SSL_CA]) {
      const database = check(
        "Database",
        status({ DATABASE_URL: marker, DATABASE_SSL_CA: certificate }, ["DATABASE_URL"])
      )
      assert.equal(database.ready, true)
      assert.equal(database.unreadable, true)
    }
    const database = check("Database", status({ DATABASE_SSL_CA: marker }, ["DATABASE_SSL_CA"]))
    assert.equal(database.ready, true)
    assert.equal(database.unreadable, true)
    assert.equal(check("Database", status({ DATABASE_SSL_CA: undefined })).ready, false)
  }
})

test("unknown required flags never waive missing or invalid readable dependencies", () => {
  for (const marker of ["", "[SENSITIVE]"]) {
    for (const shopId of [undefined, "0", "not-a-shop"]) {
      const publishing = check(
        "Printify catalog and publishing",
        status({ PRINTIFY_PUBLISHING_ENABLED: marker, PRINTIFY_SHOP_ID: shopId }, ["PRINTIFY_PUBLISHING_ENABLED"])
      )
      assert.equal(publishing.ready, false)
    }
    const payments = check(
      "Live payment and fulfillment configuration",
      status({ PRINTIFY_FULFILLMENT_ENABLED: marker, STRIPE_SECRET_KEY: "rk_test_synthetic" }, [
        "PRINTIFY_FULFILLMENT_ENABLED",
      ])
    )
    assert.equal(payments.ready, false)
  }
})

test("unknown optional flags are reported as unreadable and known disabled features stay off", () => {
  for (const [flag, name] of [
    ["ADMIN_LIBRARY_ENABLED", "Owner sign-in and private artwork"],
    ["ORDER_ALERTS_ENABLED", "Order shipping reminders"],
    ["DROP_EMAILS_ENABLED", "Weekly drop emails"],
    ["META_PIXEL_ENABLED", "Meta measurement"],
    ["GOOGLE_TAG_ENABLED", "Google measurement"],
  ]) {
    const unknown = check(name, status({ [flag]: "[SENSITIVE]" }, [flag]))
    assert.equal(unknown.ready, true)
    assert.equal(unknown.unreadable, true)
    const disabled = check(name, status({ [flag]: "false" }))
    assert.equal(disabled.ready, true)
    assert.equal(disabled.active, false)
  }
})
