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
  shortName: "New Brand",
  description: "Original illustrated tees from New Brand.",
  tagline: "Wear a little imagination.",
  features: { ...storeConfig.features, about: false },
  home: {
    ...storeConfig.home,
    headline: "Illustrations made to wear.",
    introduction: "Meet our original tee collection.",
  },
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
  DATABASE_SSL_CA: "-----BEGIN CERTIFICATE-----\nU1lOVEhFVElDLUNBLUZJWFRVUkU=\n-----END CERTIFICATE-----",
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
const now = Date.parse("2026-09-28T12:00:00Z")
const status = (env = environment, value = config, options = {}) =>
  setupStatus(value, env, {
    mode: "launch",
    now,
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
    ["SUPABASE_SECRET_KEY", "Initial owner claim configuration"],
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
    { DROP_EMAILS_ENABLED: "true" },
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

test("weekly drop emails need a sender, postal address, weekly feature, list and schedule", () => {
  const enabled = {
    ...environment,
    DROP_EMAILS_ENABLED: "true",
    RESEND_API_KEY: "i".repeat(32),
    DROP_EMAIL_FROM_EMAIL: "drops@newbrand.com",
    STORE_POSTAL_ADDRESS: "PO Box 1234, Springfield, OR 97477",
  }
  const weekly = {
    ...config,
    features: { ...config.features, designOfTheWeek: true, dropSignup: true },
    privacy: { retainedDropSubscribers: false, retainedDropEmailRecords: true },
  }
  const drops = (env, value = weekly, options) => ready("Weekly drop emails", status(env, value, options))
  assert.equal(drops(enabled), true)
  assert.equal(status(environment, weekly).find((check) => check.name === "Weekly drop emails")?.active, false)
  for (const name of ["RESEND_API_KEY", "DROP_EMAIL_FROM_EMAIL", "STORE_POSTAL_ADDRESS"])
    assert.equal(drops({ ...enabled, [name]: undefined }), false, name)
  assert.equal(drops({ ...enabled, DROP_EMAIL_FROM_EMAIL: "drops@example.com" }), false)
  assert.equal(drops({ ...enabled, STORE_POSTAL_ADDRESS: "PO Box 1234\nSpringfield, OR 97477" }), false)
  assert.equal(drops(enabled, { ...weekly, features: { ...weekly.features, designOfTheWeek: false } }), false)
  const closed = { ...weekly, features: { ...weekly.features, dropSignup: false } }
  assert.equal(drops(enabled, closed), false)
  // A closed list that kept its subscribers can still hear about drops.
  assert.equal(
    drops(enabled, { ...closed, privacy: { retainedDropSubscribers: true, retainedDropEmailRecords: true } }),
    true
  )
  // Privacy has to be ready to describe the delivery records before the first one exists.
  assert.equal(drops(enabled, { ...weekly, privacy: { ...weekly.privacy, retainedDropEmailRecords: false } }), false)
  const withoutDropSchedule = schedules.filter((entry) => entry.path !== "/api/internal/drop-emails")
  assert.equal(drops(enabled, weekly, { schedules: withoutDropSchedule }), false)
  const sandbox = { ...enabled, STRIPE_SECRET_KEY: `rk_test_${"f".repeat(64)}`, PRINTIFY_FULFILLMENT_ENABLED: "false" }
  const sandboxChecks = status(sandbox, weekly, { mode: "sandbox", schedules: [] })
  assert.equal(sandboxChecks.find((check) => check.name === "Weekly drop emails")?.active, false)
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
    ready(
      "Initial owner claim configuration",
      status({ ...enabled, ADMIN_SETUP_SECRET: "j".repeat(32), SUPABASE_SECRET_KEY: "k".repeat(32) })
    ),
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

test("launch rejects frozen template copy while optional about and preparation remain available", () => {
  for (const [field, value] of [
    ["description", "A new home for original apparel. Our first collection is on its way."],
    ["tagline", "Make room for your next favorite."],
    ["home.headline", "Your next favorite starts here."],
    ["home.introduction", "Something new is taking shape. Explore the store as we prepare our first collection."],
  ]) {
    const candidate = structuredClone(config)
    const parts = field.split(".")
    if (parts.length === 1) candidate[field] = value
    else candidate[parts[0]][parts[1]] = value
    assert.equal(ready("Storefront copy", status(environment, candidate)), false, field)
    assert.ok(
      status(environment, candidate, { mode: "configuration" }).every((check) => check.ready),
      field
    )
  }
  assert.ok(status().every((check) => check.ready))
  const enabledAbout = {
    ...config,
    features: { ...config.features, about: true },
    about: {
      heading: "A brand in the making.",
      paragraphs: [
        "We’re getting ready to share our first collection. Come back soon to discover our story and designs.",
      ],
    },
  }
  assert.equal(ready("Storefront copy", status(environment, enabledAbout)), false)
  for (const about of [
    { heading: "A brand in the making.", paragraphs: ["Our designers started New Brand in 2026."] },
    {
      heading: "The New Brand story",
      paragraphs: [
        "We’re getting ready to share our first collection. Come back soon to discover our story and designs.",
        "Our designers started New Brand in 2026.",
      ],
    },
  ])
    assert.equal(ready("Storefront copy", status(environment, { ...enabledAbout, about })), false)
  assert.equal(
    ready(
      "Storefront copy",
      status(environment, {
        ...enabledAbout,
        about: { heading: "The New Brand story", paragraphs: ["Our designers started New Brand in 2026."] },
      })
    ),
    true
  )
})

test("brand readiness rejects an unchanged short name", () => {
  assert.equal(ready("Brand and contact details", status(environment, { ...config, shortName: "Your Store" })), false)
  assert.equal(ready("Brand and contact details", status()), true)
})

test("saved commerce identity must match the configured immutable identity", () => {
  for (const saved of ["stable-store", undefined, null]) {
    assert.equal(
      ready(
        "Immutable commerce identity",
        status(environment, config, { setupState: { decisions: { commerceIdentity: saved } } })
      ),
      true
    )
  }
  assert.equal(
    ready(
      "Immutable commerce identity",
      status(environment, config, { setupState: { decisions: { commerceIdentity: "previous-store" } } })
    ),
    false
  )
})

test("recorded Printify rotation dates become actionable within thirty days", () => {
  const rotationStatus = (credentialRotationDueAt) =>
    status(environment, config, {
      setupState: { providers: { printify: { credentialRotationDueAt } } },
    }).find((check) => check.name === "Printify credential rotation")
  for (const date of [undefined, null]) assert.equal(rotationStatus(date)?.active, false)
  for (const days of [-1, 0, 1, 30])
    assert.equal(rotationStatus(new Date(now + days * 86_400_000).toISOString())?.ready, false)
  assert.equal(rotationStatus(new Date(now + 30 * 86_400_000 + 1).toISOString())?.ready, true)
  for (const value of ["", "not-a-date", 42]) assert.equal(rotationStatus(value)?.ready, false)
})

test("ordinary approved policy prose passes while actual drafting markers remain blocked", () => {
  for (const sentence of [
    "Need a different size... just email us within 30 days.",
    "Returns are issued as credit to your store account within 5 days.",
    "Email us at <hello@newbrand.com> within 30 days.",
  ])
    assert.equal(
      ready(
        "Shipping and policies",
        status(environment, { ...config, policies: { ...config.policies, returnsText: [sentence] } })
      ),
      true,
      sentence
    )
  for (const sentence of [
    "[TODO review returns]",
    "[OWNER to supply policy]",
    "TODO: Review returns",
    "TBD",
    "CHANGEME",
    "Lorem ipsum",
  ])
    assert.equal(
      ready(
        "Shipping and policies",
        status(environment, { ...config, policies: { ...config.policies, returnsText: [sentence] } })
      ),
      false,
      sentence
    )
})

test("a matching verified claim waives both initial enrollment secrets but not ongoing owner access", () => {
  const admin = {
    ...environment,
    ADMIN_LIBRARY_ENABLED: "true",
    ADMIN_OWNER_EMAIL: "owner@newbrand.com",
    NEXT_PUBLIC_SUPABASE_URL: "https://newbrand.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "k".repeat(32),
    PRIVATE_BLOB_READ_WRITE_TOKEN: "m".repeat(32),
    PRINTIFY_DRAFTS_API_TOKEN: "n".repeat(32),
  }
  const ownerClaim = {
    status: "verified",
    supabaseProjectUrl: admin.NEXT_PUBLIC_SUPABASE_URL,
    verifiedAt: "2026-09-27T12:00:00Z",
    evidence: "Owner claim consumed; membership verified in intended environment.",
  }
  const options = {
    setupState: { decisions: { printifyBlueprintId: 1317, printifyPrintProviderId: 99 }, verification: { ownerClaim } },
  }
  assert.ok(status(admin, config, options).every((check) => check.ready))
  for (const secrets of [{}, { ADMIN_SETUP_SECRET: "j".repeat(32) }, { SUPABASE_SECRET_KEY: "k".repeat(32) }])
    assert.equal(ready("Initial owner claim configuration", status({ ...admin, ...secrets })), false)
  assert.equal(
    ready(
      "Initial owner claim configuration",
      status({ ...admin, ADMIN_SETUP_SECRET: "j".repeat(32), SUPABASE_SECRET_KEY: "k".repeat(32) })
    ),
    true
  )
  for (const override of [
    { status: "pending" },
    { supabaseProjectUrl: "https://other.supabase.co" },
    { verifiedAt: "invalid" },
    { evidence: "" },
  ]) {
    assert.equal(
      ready(
        "Initial owner claim configuration",
        status(admin, config, { setupState: { verification: { ownerClaim: { ...ownerClaim, ...override } } } })
      ),
      false
    )
  }
  assert.equal(
    ready(
      "Owner sign-in and private artwork",
      status({ ...admin, PRIVATE_BLOB_READ_WRITE_TOKEN: undefined }, config, options)
    ),
    false
  )
})

test("production order reminders are inactive during sandbox checkout", () => {
  const sandbox = {
    ...environment,
    STRIPE_SECRET_KEY: `rk_test_${"f".repeat(64)}`,
    PRINTIFY_FULFILLMENT_ENABLED: "false",
    ORDER_ALERTS_ENABLED: "true",
  }
  const checks = status(sandbox, config, { mode: "sandbox", schedules: [] })
  assert.equal(checks.find((check) => check.name === "Order shipping reminders")?.active, false)
  assert.ok(checks.every((check) => check.ready))
  assert.equal(ready("Order shipping reminders", status({ ...environment, ORDER_ALERTS_ENABLED: "true" })), false)
})

test("Supabase connections require an explicit CA source without changing other hosts", () => {
  for (const host of ["aws-0.pooler.supabase.com", "db.project.supabase.co"]) {
    const DATABASE_URL = environment.DATABASE_URL.replace("aws-0.pooler.supabase.com", host)
    for (const DATABASE_SSL_CA of [
      undefined,
      "",
      "not-a-certificate",
      "-----BEGIN CERTIFICATE-----\n-----END CERTIFICATE-----",
    ])
      assert.equal(ready("Database", status({ ...environment, DATABASE_URL, DATABASE_SSL_CA })), false, host)
    assert.equal(ready("Database", status({ ...environment, DATABASE_URL })), true, host)
    assert.equal(
      ready(
        "Database",
        status({
          ...environment,
          DATABASE_URL: `${DATABASE_URL}&sslrootcert=%2Frun%2Fcerts%2Fsupabase.crt`,
          DATABASE_SSL_CA: undefined,
        })
      ),
      true,
      host
    )
    assert.equal(
      ready(
        "Database",
        status({ ...environment, DATABASE_URL: `${DATABASE_URL}&sslrootcert=`, DATABASE_SSL_CA: undefined })
      ),
      false,
      host
    )
    assert.equal(
      ready(
        "Database",
        status({ ...environment, DATABASE_URL: `${DATABASE_URL}&sslrootcert=%2Frun%2Fcerts%2Fsupabase.crt` })
      ),
      false,
      host
    )
  }
  assert.equal(
    ready(
      "Database",
      status({
        ...environment,
        DATABASE_URL: environment.DATABASE_URL.replace("aws-0.pooler.supabase.com", "db.newbrand.com"),
        DATABASE_SSL_CA: undefined,
      })
    ),
    true
  )
  assert.equal(
    ready(
      "Database",
      status(
        {
          ...environment,
          DATABASE_URL: "postgresql://store_app_runtime:local-password@localhost:55497/postgres",
          DATABASE_SSL_CA: undefined,
        },
        config,
        { mode: "sandbox" }
      )
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

test("capacity overrides use the runtime parser without exposing values", () => {
  for (const value of [undefined, "", '{"status":{"burst":40}}'])
    assert.equal(
      ready("Checkout capacity overrides", status({ ...environment, CHECKOUT_CAPACITY_LIMITS: value })),
      true
    )
  for (const value of ["not-json", '{"unknown":{}}', '{"providerRead":{"burst":1}}', '{"status":{"perMinute":0}}'])
    assert.equal(
      ready("Checkout capacity overrides", status({ ...environment, CHECKOUT_CAPACITY_LIMITS: value })),
      false
    )
  const hidden = status({ ...environment, CHECKOUT_CAPACITY_LIMITS: "[SENSITIVE]" }, config, {
    unreadableKeys: ["CHECKOUT_CAPACITY_LIMITS"],
  }).find((check) => check.name === "Checkout capacity overrides")
  assert.equal(hidden.unreadable, true)
  assert.deepEqual(hidden.unreadableKeys, ["CHECKOUT_CAPACITY_LIMITS"])
})

test("signup confirmation needs explicit sending, a disclosed list and its worker schedule", () => {
  const list = { ...config, features: { ...config.features, dropSignup: true } }
  const enabled = {
    ...environment,
    SIGNUP_CONFIRMATIONS_ENABLED: "true",
    RESEND_API_KEY: "i".repeat(32),
    DROP_EMAIL_FROM_EMAIL: "drops@newbrand.com",
  }
  const confirmation = (env, value = list, options) => ready("Signup inbox confirmation", status(env, value, options))
  assert.equal(confirmation(enabled), true)
  assert.equal(confirmation({ ...enabled, SIGNUP_CONFIRMATIONS_ENABLED: "false" }), false)
  assert.equal(confirmation({ ...enabled, RESEND_API_KEY: undefined }), false)
  assert.equal(
    confirmation(enabled, list, {
      schedules: schedules.filter((entry) => entry.path !== "/api/internal/signup-confirmations"),
    }),
    false
  )
  assert.equal(confirmation(enabled, { ...list, policies: { ...list.policies, published: false } }), false)
  assert.equal(confirmation(enabled, { ...list, features: { ...list.features, dropSignup: false } }), false)
})

test("pending expiry requires its authenticated worker for retained lists even with both senders off", () => {
  const retained = { ...config, privacy: { ...config.privacy, retainedDropSubscribers: true } }
  const disabled = { ...environment, SIGNUP_CONFIRMATIONS_ENABLED: "false", DROP_EMAILS_ENABLED: "false" }
  const expiry = (env = disabled, value = retained, options) =>
    status(env, value, options).find((check) => check.name === "Pending signup expiry")
  assert.equal(expiry().active, true)
  assert.equal(expiry().ready, true)
  assert.equal(expiry(disabled, retained, { schedules: [] }).ready, false)
  assert.equal(expiry({ ...disabled, CRON_SECRET: undefined }).ready, false)
  assert.equal(expiry(disabled, { ...retained, policies: { ...retained.policies, published: false } }).ready, false)
  assert.equal(expiry(disabled, config).active, false)
  assert.equal(expiry(disabled, retained, { mode: "sandbox" }).active, false)
})
