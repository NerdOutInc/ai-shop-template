import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { storeConfig } from "../../src/lib/store-config.ts"
import { setupStatus } from "./setup-status.mjs"

const config = {
  ...storeConfig,
  configured: true,
  id: "new-brand",
  name: "New Brand",
  supportEmail: "hello@newbrand.com",
  commerce: { ...storeConfig.commerce, identity: "stable-store", shippingConfirmed: true },
  policies: {
    published: true,
    shippingText: ["Contact support for delivery questions."],
    returnsText: ["Contact support to arrange eligible returns."],
    privacyText: ["We use order details to fulfill purchases."],
  },
}
const environment = {
  NEXT_PUBLIC_SITE_URL: "https://newbrand.com",
  DATABASE_URL:
    "postgresql://store_app_runtime.project:local-only-password@aws-0.pooler.supabase.com:5432/postgres?sslmode=verify-full",
  PRINTIFY_PUBLISHING_ENABLED: "true",
  PRINTIFY_FULFILLMENT_ENABLED: "true",
  PRINTIFY_API_TOKEN: "a".repeat(64),
  PRINTIFY_PUBLISHING_API_TOKEN: "b".repeat(64),
  PRINTIFY_SHOP_ID: "1234567",
  PRINTIFY_WEBHOOK_SECRET: "c".repeat(32),
  CRON_SECRET: "d".repeat(32),
  NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST: "newbrand.public.blob.vercel-storage.com",
  BLOB_READ_WRITE_TOKEN: "e".repeat(64),
  CHECKOUT_RATE_LIMIT_SECRET: "h".repeat(32),
  STRIPE_SECRET_KEY: `rk_live_${"f".repeat(64)}`,
  STRIPE_WEBHOOK_SECRET: `whsec_${"g".repeat(32)}`,
}
const schedules = JSON.parse(readFileSync(new URL("../vercel-crons.example.json", import.meta.url))).crons
const status = (env = environment, value = config, options = {}) =>
  setupStatus(value, env, {
    mode: "launch",
    schedules,
    setupState: { decisions: { printifyBlueprintId: 1317, printifyPrintProviderId: 99 } },
    ...options,
  })
const ready = (name, checks) => checks.find((check) => check.name === name)?.ready

test("configured values pass local checks without claiming remote verification", () => {
  assert.ok(status().every((check) => check.ready))
})

test("rejects template domains, malformed origins and placeholder policies", () => {
  for (const domain of [
    "example.com",
    "store.example",
    "store.example.org",
    "localhost",
    "store.test",
    "store.invalid",
  ])
    assert.equal(
      ready("Canonical domain", status({ ...environment, NEXT_PUBLIC_SITE_URL: `https://${domain}` })),
      false
    )
  for (const origin of ["https://newbrand.com/path", "https://user@newbrand.com", "https://newbrand.com?token=x"])
    assert.equal(ready("Canonical domain", status({ ...environment, NEXT_PUBLIC_SITE_URL: origin })), false)
  for (const policy of [[], ["TODO"], ["TBD: return policy"], ["Lorem ipsum"], ["[OWNER TO FILL IN]"]])
    assert.equal(
      ready(
        "Shipping and policies",
        status(environment, { ...config, policies: { ...config.policies, returnsText: policy } })
      ),
      false
    )
})

test("rejects runtime-invalid connections and a privileged app login", () => {
  for (const url of [
    "not-a-url",
    environment.DATABASE_URL.replace(":5432", ":6543"),
    environment.DATABASE_URL.replace(":5432", ":6544"),
    environment.DATABASE_URL.replace("verify-full", "require"),
    environment.DATABASE_URL.replace("store_app_runtime.project", "postgres.project"),
    `${environment.DATABASE_URL}&host=elsewhere`,
  ])
    assert.equal(ready("Database", status({ ...environment, DATABASE_URL: url })), false)
})

test("rejects example credentials and runtime secret length violations without disclosure", () => {
  for (const [key, value] of Object.entries({
    PRINTIFY_WEBHOOK_SECRET: "short",
    CRON_SECRET: "short",
    STRIPE_SECRET_KEY: "rk_live_...",
    STRIPE_WEBHOOK_SECRET: "whsec_...",
    PRINTIFY_API_TOKEN: "YOUR_TOKEN",
    PRINTIFY_SHOP_ID: "invalid-shop-sentinel",
    NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST: "STORE.public.blob.vercel-storage.com",
  })) {
    const checks = status({ ...environment, [key]: value })
    assert.ok(
      checks.some((check) => !check.ready),
      key
    )
    assert.ok(!JSON.stringify(checks).includes(value), key)
  }
})

test("header-bound credentials reject line breaks without disclosing their values", () => {
  const admin = {
    ...environment,
    ADMIN_LIBRARY_ENABLED: "true",
    ADMIN_OWNER_EMAIL: "owner@newbrand.com",
    ADMIN_SETUP_SECRET: "j".repeat(32),
    NEXT_PUBLIC_SUPABASE_URL: "https://newbrand.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "k".repeat(32),
    SUPABASE_SECRET_KEY: "l".repeat(32),
    PRIVATE_BLOB_READ_WRITE_TOKEN: "m".repeat(32),
    PRINTIFY_DRAFTS_API_TOKEN: "n".repeat(32),
  }
  assert.ok(status(admin).every((check) => check.ready))
  for (const [key, checkName] of [
    ["PRINTIFY_API_TOKEN", "Printify catalog and publishing"],
    ["PRINTIFY_PUBLISHING_API_TOKEN", "Printify catalog and publishing"],
    ["BLOB_READ_WRITE_TOKEN", "Printify catalog and publishing"],
    ["CRON_SECRET", "Printify catalog and publishing"],
    ["PRINTIFY_DRAFTS_API_TOKEN", "Library product drafts"],
    ["STRIPE_SECRET_KEY", "Stripe payments"],
    ["SUPABASE_SECRET_KEY", "Owner sign-in and private artwork"],
    ["PRIVATE_BLOB_READ_WRITE_TOKEN", "Owner sign-in and private artwork"],
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "Owner sign-in and private artwork"],
    ["RESEND_API_KEY", "Environment syntax"],
    ["PRINTIFY_MONITOR_SECRET", "Environment syntax"],
  ]) {
    for (const lineBreak of ["\r", "\n"]) {
      const value = `header-secret-sentinel-${"x".repeat(32)}${lineBreak}suffix`
      const checks = status({ ...admin, [key]: value })
      assert.equal(ready("Environment syntax", checks), false, key)
      assert.equal(ready(checkName, checks), false, key)
      assert.ok(!JSON.stringify(checks).includes("header-secret-sentinel"), key)
    }
  }
})

test("launch requires actual publishing and stock schedules; disabled monitor is optional", () => {
  for (const missing of [
    "/api/internal/printify-publishing",
    "/api/internal/catalog-sync/stock",
    "/api/internal/catalog-sync/popularity",
  ])
    assert.ok(
      status(environment, config, { schedules: schedules.filter((entry) => entry.path !== missing) }).some(
        (check) => !check.ready
      )
    )
  assert.ok(
    status(environment, config, { schedules: schedules.map((entry) => ({ ...entry, schedule: "0 0 * * *" })) }).some(
      (check) => !check.ready
    )
  )
  assert.ok(status().every((check) => check.ready))
})

test("sandbox gates use test keys and disabled fulfillment without requiring production cron", () => {
  const sandbox = {
    ...environment,
    NEXT_PUBLIC_SITE_URL: "http://localhost:3017",
    DATABASE_URL: "postgresql://store_app_runtime:local-only-password@localhost:55497/postgres",
    STRIPE_SECRET_KEY: `rk_test_${"f".repeat(64)}`,
    PRINTIFY_FULFILLMENT_ENABLED: "false",
  }
  assert.ok(status(sandbox, config, { mode: "sandbox", schedules: [] }).every((check) => check.ready))
  assert.ok(status(environment, config, { mode: "sandbox" }).some((check) => !check.ready))
  assert.ok(status(sandbox).some((check) => !check.ready))
})

test("optional integration values are validated when supplied, without becoming universal launch requirements", () => {
  assert.ok(status().every((check) => check.ready))
  for (const optional of [
    { GOOGLE_MERCHANT_FEED_PASSWORD: "short" },
    { ADMIN_LIBRARY_ENABLED: "true" },
    { ORDER_ALERTS_ENABLED: "true" },
    { META_PIXEL_ENABLED: "true" },
  ])
    assert.ok(status({ ...environment, ...optional }).some((check) => !check.ready))
})

test("saved onboarding provider choice must match the built-in color workflow", () => {
  assert.equal(ready("Initial garment selection", status(environment, config, { setupState: undefined })), false)
  assert.equal(
    ready(
      "Initial garment selection",
      status(environment, config, {
        setupState: { decisions: { printifyBlueprintId: 1317, printifyPrintProviderId: 1 } },
      })
    ),
    false
  )
})

test("checkout identity and admission secret are required for new stores", () => {
  const commerce = { ...config.commerce, identity: "stable-store" }
  assert.equal(
    ready(
      "Immutable commerce identity",
      status(environment, { ...config, commerce: { ...commerce, identity: undefined } })
    ),
    false
  )
  assert.equal(
    ready(
      "Checkout admission secret",
      status({ ...environment, CHECKOUT_RATE_LIMIT_SECRET: undefined }, { ...config, commerce })
    ),
    false
  )
  assert.ok(
    status({ ...environment, CHECKOUT_RATE_LIMIT_SECRET: "h".repeat(32) }, { ...config, commerce }).every(
      (check) => check.ready
    )
  )
})

test("catalog and optional alerts obey their runtime prerequisites", () => {
  for (const shop of ["0", "01"])
    assert.equal(ready("Printify catalog and publishing", status({ ...environment, PRINTIFY_SHOP_ID: shop })), false)
  assert.equal(
    ready("Printify catalog and publishing", status({ ...environment, PRINTIFY_API_TOKEN: "header\ninjection" })),
    false
  )
  assert.equal(
    ready(
      "Order shipping reminders",
      status({
        ...environment,
        ORDER_ALERTS_ENABLED: "true",
        RESEND_API_KEY: "i".repeat(32),
        ORDER_ALERT_FROM_EMAIL: "alerts@newbrand.com",
      })
    ),
    false
  )
  assert.equal(
    ready(
      "Canonical domain",
      status({ ...environment, NEXT_PUBLIC_SITE_URL: "http://[::1]:3017" }, config, { mode: "sandbox" })
    ),
    false
  )
  assert.ok(status(environment, config, { schedules: [null] }).some((check) => !check.ready))
})

test("enabled owner bootstrap requires a valid setup proof or dated claim evidence", () => {
  const enabled = {
    ...environment,
    ADMIN_LIBRARY_ENABLED: "true",
    NEXT_PUBLIC_SUPABASE_URL: "https://newbrand.supabase.co",
  }
  assert.equal(ready("Initial owner claim configuration", status(enabled)), false)
  assert.equal(ready("Initial owner claim configuration", status({ ...enabled, ADMIN_SETUP_SECRET: "short" })), false)
  assert.equal(
    ready("Initial owner claim configuration", status({ ...enabled, ADMIN_SETUP_SECRET: "j".repeat(32) })),
    true
  )
  assert.equal(
    ready(
      "Initial owner claim configuration",
      status(enabled, config, {
        setupState: {
          verification: {
            ownerClaim: {
              status: "verified",
              supabaseProjectUrl: "https://newbrand.supabase.co",
              verifiedAt: "2026-09-27T12:00:00Z",
              evidence: "Owner claim consumed; membership verified in intended environment.",
            },
          },
        },
      })
    ),
    true
  )
})

test("enabled Meta measurement uses the runtime pixel ID length boundaries", () => {
  for (const length of [1, 4, 26]) {
    assert.equal(
      ready(
        "Meta measurement",
        status({ ...environment, META_PIXEL_ENABLED: "true", META_PIXEL_ID: "1".repeat(length) })
      ),
      false,
      `Reject ${length}-digit pixel IDs`
    )
  }
  for (const length of [5, 25]) {
    assert.equal(
      ready(
        "Meta measurement",
        status({ ...environment, META_PIXEL_ENABLED: "true", META_PIXEL_ID: "1".repeat(length) })
      ),
      true,
      `Accept the ${length}-digit boundary`
    )
  }
  assert.equal(
    ready("Meta measurement", status({ ...environment, META_PIXEL_ENABLED: "false", META_PIXEL_ID: "1" })),
    true
  )
})
