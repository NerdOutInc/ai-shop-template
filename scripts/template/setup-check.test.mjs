import assert from "node:assert/strict"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { storeConfig } from "../../src/lib/store-config.ts"

const require = createRequire(import.meta.url)
const script = fileURLToPath(new URL("./setup-check.mjs", import.meta.url))

test("CLI reads isolated local configuration, rejects strict modes, and never echoes secrets", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "store-setup-check-"))
  try {
    writeFileSync(
      path.join(cwd, ".env.local"),
      "PRINTIFY_WEBHOOK_SECRET=secret-sentinel\nDATABASE_URL=redacted-sentinel\nCRON_SECRET=short\n"
    )
    writeFileSync(path.join(cwd, "vercel.json"), JSON.stringify({ crons: { invalid: true } }))
    for (const args of [[], ["--sandbox"], ["--launch"]]) {
      const result = spawnSync(
        process.execPath,
        ["--conditions=react-server", "--import", require.resolve("tsx"), "--", script, ...args],
        {
          cwd,
          env: { PATH: process.env.PATH, NODE_ENV: "development" },
          encoding: "utf8",
        }
      )
      assert.equal(result.status, args.length ? 1 : 0)
      const output = result.stdout + result.stderr
      assert.match(output, /Remote readiness: UNVERIFIED/)
      assert.match(output, /PRINTIFY_WEBHOOK_SECRET/)
      assert.doesNotMatch(output, /secret-sentinel|redacted-sentinel|Invalid environment variables/)
    }
    const productionFile = path.join(cwd, "production.env")
    writeFileSync(productionFile, `PRINTIFY_WEBHOOK_SECRET=${"x".repeat(32)}\n`, { mode: 0o600 })
    const isolated = spawnSync(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        require.resolve("tsx"),
        "--",
        script,
        "--launch",
        "--env-file",
        productionFile,
      ],
      {
        cwd,
        env: {
          PATH: process.env.PATH,
          PRINTIFY_WEBHOOK_SECRET: "parent-secret-sentinel",
          PRINTIFY_MONITOR_SECRET: "short",
        },
        encoding: "utf8",
      }
    )
    assert.equal(isolated.status, 1)
    assert.match(isolated.stdout, /CONFIGURED Environment syntax/)
    assert.doesNotMatch(isolated.stdout + isolated.stderr, /parent-secret-sentinel|redacted-sentinel|secret-sentinel/)
    writeFileSync(productionFile, 'BLOB_READ_WRITE_TOKEN="header-secret-sentinel\nsecret-suffix"\n')
    const invalidHeader = spawnSync(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        require.resolve("tsx"),
        "--",
        script,
        "--launch",
        "--env-file",
        productionFile,
      ],
      { cwd, env: { PATH: process.env.PATH }, encoding: "utf8" }
    )
    assert.equal(invalidHeader.status, 1)
    assert.match(invalidHeader.stdout, /TODO\s+Environment syntax/)
    assert.match(invalidHeader.stdout, /BLOB_READ_WRITE_TOKEN/)
    assert.doesNotMatch(invalidHeader.stdout + invalidHeader.stderr, /header-secret-sentinel|secret-suffix/)
    const invalid = spawnSync(
      process.execPath,
      ["--conditions=react-server", "--import", require.resolve("tsx"), "--", script, "--sandbox", "--launch"],
      { cwd, env: { PATH: process.env.PATH }, encoding: "utf8" }
    )
    assert.equal(invalid.status, 1)
    assert.match(invalid.stderr, /Usage:/)
    const missingFile = spawnSync(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        require.resolve("tsx"),
        "--",
        script,
        "--env-file",
        path.join(cwd, "private-path-sentinel"),
      ],
      { cwd, env: { PATH: process.env.PATH }, encoding: "utf8" }
    )
    assert.equal(missingFile.status, 1)
    assert.match(missingFile.stderr, /explicit environment file could not be read/)
    assert.doesNotMatch(missingFile.stderr, /private-path-sentinel/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test("strict CLI wiring distinguishes unreadable exports from missing and invalid values", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "onboarding-export-"))
  try {
    const repository = fileURLToPath(new URL("../../", import.meta.url))
    mkdirSync(path.join(cwd, "src"))
    mkdirSync(path.join(cwd, "scripts"))
    cpSync(path.join(repository, "src/lib"), path.join(cwd, "src/lib"), { recursive: true })
    mkdirSync(path.join(cwd, "src/features/checkout"), { recursive: true })
    cpSync(
      path.join(repository, "src/features/checkout/parse-checkout-capacity-limits.ts"),
      path.join(cwd, "src/features/checkout/parse-checkout-capacity-limits.ts")
    )
    cpSync(path.join(repository, "scripts/template"), path.join(cwd, "scripts/template"), { recursive: true })
    symlinkSync(path.join(repository, "node_modules"), path.join(cwd, "node_modules"), "dir")
    writeFileSync(path.join(cwd, "package.json"), '{"type":"module"}')
    const config = {
      ...storeConfig,
      configured: true,
      id: "export-fixture",
      name: "Export Fixture",
      shortName: "Export",
      tagline: "Clothes for slow mornings.",
      description: "Original prints on comfortable everyday clothing.",
      supportEmail: "hello@exportfixture.com",
      home: {
        ...storeConfig.home,
        headline: "Start the day outside.",
        introduction: "Explore original prints inspired by the garden.",
      },
      features: { ...storeConfig.features, about: false },
      commerce: { ...storeConfig.commerce, identity: "export-fixture", shippingConfirmed: true },
      policies: {
        published: true,
        shippingText: ["Contact us for delivery questions."],
        returnsText: ["Contact us about returns."],
        privacyText: ["Order details are used to deliver purchases."],
      },
    }
    writeFileSync(
      path.join(cwd, "src/lib/store-config.ts"),
      `import { storeConfigSchema } from "./store-config-schema"\nexport const storeConfig = storeConfigSchema.parse(${JSON.stringify(config)})\n`
    )
    writeFileSync(
      path.join(cwd, ".store-setup.local.json"),
      JSON.stringify({
        decisions: { commerceIdentity: "export-fixture", printifyBlueprintId: 1317, printifyPrintProviderId: 99 },
      })
    )
    writeFileSync(
      path.join(cwd, "vercel.json"),
      readFileSync(path.join(repository, "scripts/vercel-crons.example.json"))
    )
    const values = {
      NEXT_PUBLIC_SITE_URL: "https://exportfixture.com",
      DATABASE_URL:
        "postgresql://store_app_runtime.project:syntheticpassword@aws-0.pooler.supabase.com:5432/postgres?sslmode=verify-full",
      DATABASE_SSL_CA: "-----BEGIN CERTIFICATE-----\nY2VydGlmaWNhdGU=\n-----END CERTIFICATE-----",
      PRINTIFY_PUBLISHING_ENABLED: "true",
      PRINTIFY_FULFILLMENT_ENABLED: "true",
      PRINTIFY_API_TOKEN: "a".repeat(64),
      PRINTIFY_PUBLISHING_API_TOKEN: "b".repeat(64),
      PRINTIFY_DRAFTS_API_TOKEN: "c".repeat(64),
      PRINTIFY_SHOP_ID: "1234567",
      PRINTIFY_WEBHOOK_SECRET: "d".repeat(32),
      CRON_SECRET: "e".repeat(32),
      NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST: "exportfixture.public.blob.vercel-storage.com",
      BLOB_READ_WRITE_TOKEN: "f".repeat(64),
      CHECKOUT_RATE_LIMIT_SECRET: "g".repeat(32),
      STRIPE_SECRET_KEY: `rk_live_${"h".repeat(64)}`,
      STRIPE_WEBHOOK_SECRET: `whsec_${"i".repeat(32)}`,
      ADMIN_LIBRARY_ENABLED: "true",
      ADMIN_OWNER_EMAIL: "owner@exportfixture.com",
      ADMIN_SETUP_SECRET: "j".repeat(32),
      NEXT_PUBLIC_SUPABASE_URL: "https://exportfixture.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "k".repeat(32),
      SUPABASE_SECRET_KEY: "l".repeat(32),
      PRIVATE_BLOB_READ_WRITE_TOKEN: "m".repeat(32),
    }
    const envFile = path.join(cwd, "export.env")
    const run = (env) => {
      writeFileSync(
        envFile,
        Object.entries(env)
          .map(([key, value]) => `${key}="${value}"`)
          .join("\n"),
        { mode: 0o600 }
      )
      return spawnSync(
        process.execPath,
        [
          "--conditions=react-server",
          "--import",
          require.resolve("tsx"),
          "--",
          path.join(cwd, "scripts/template/setup-check.mjs"),
          "--launch",
          "--env-file",
          envFile,
        ],
        { cwd, env: { PATH: process.env.PATH, CRON_SECRET: "short" }, encoding: "utf8" }
      )
    }
    writeFileSync(path.join(cwd, ".env.local"), "PRINTIFY_MONITOR_SECRET=short\n")
    const complete = run(values)
    assert.equal(complete.status, 0, complete.stdout + complete.stderr)
    assert.match(complete.stdout, /Configuration gates passed/)
    assert.doesNotMatch(complete.stdout, /UNREADABLE/)
    const secretKeys = [
      "DATABASE_URL",
      "DATABASE_SSL_CA",
      "PRINTIFY_API_TOKEN",
      "PRINTIFY_PUBLISHING_API_TOKEN",
      "PRINTIFY_DRAFTS_API_TOKEN",
      "PRINTIFY_WEBHOOK_SECRET",
      "CRON_SECRET",
      "BLOB_READ_WRITE_TOKEN",
      "CHECKOUT_RATE_LIMIT_SECRET",
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "ADMIN_SETUP_SECRET",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SECRET_KEY",
      "PRIVATE_BLOB_READ_WRITE_TOKEN",
    ]
    for (const marker of ["", "[SENSITIVE]"]) {
      const masked = { ...values, ...Object.fromEntries(secretKeys.map((key) => [key, marker])) }
      const result = run(masked)
      assert.equal(result.status, 0, result.stdout + result.stderr)
      for (const key of secretKeys) assert.match(result.stdout, new RegExp(`UNREADABLE ${key}:`))
      assert.match(result.stdout, /Readable configuration checks passed; hidden values remain unverified/)
      assert.doesNotMatch(
        result.stdout,
        /Configuration gates passed|CONFIGURED (?:Stripe payments|Owner sign-in|Printify catalog)/
      )
      const missing = { ...masked }
      delete missing.PRINTIFY_SHOP_ID
      assert.equal(run(missing).status, 1)
      const invalid = run({ ...masked, PRINTIFY_SHOP_ID: "not-a-shop" })
      assert.equal(invalid.status, 1)
      assert.match(invalid.stdout, /TODO\s+Printify catalog/)
      assert.equal(run({ ...masked, NEXT_PUBLIC_SITE_URL: "https://example.com" }).status, 1)
      assert.equal(run({ ...masked, STRIPE_SECRET_KEY: "rk_test_wrongmode" }).status, 1)
    }
    const fiveOpaque = run({
      ...values,
      ...Object.fromEntries(
        [
          "PRINTIFY_API_TOKEN",
          "PRINTIFY_PUBLISHING_API_TOKEN",
          "PRINTIFY_DRAFTS_API_TOKEN",
          "SUPABASE_SECRET_KEY",
          "PRIVATE_BLOB_READ_WRITE_TOKEN",
        ].map((key) => [key, "[SENSITIVE]"])
      ),
    })
    assert.equal(fiveOpaque.status, 0)
    assert.match(fiveOpaque.stdout, /hidden values remain unverified/)
    assert.doesNotMatch(fiveOpaque.stdout, /Configuration gates passed/)
    const missingRequired = { ...values }
    delete missingRequired.CRON_SECRET
    assert.equal(run(missingRequired).status, 1)
    const shortSecret = run({ ...values, CRON_SECRET: "short-sentinel" })
    assert.equal(shortSecret.status, 1)
    assert.doesNotMatch(shortSecret.stdout + shortSecret.stderr, /short-sentinel/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
