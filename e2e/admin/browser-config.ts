import { devices, type PlaywrightTestConfig } from "@playwright/test"

import { offlineStoreEnvironment } from "../offline-store-environment"

import { adminTestConfig } from "./admin-test-config"

export function adminBrowserConfig(): PlaywrightTestConfig {
  const config = adminTestConfig()
  return {
    testDir: "./e2e/admin",
    fullyParallel: false,
    forbidOnly: Boolean(process.env.CI),
    workers: 1,
    retries: 0,
    timeout: 180_000,
    expect: { timeout: 15_000 },
    outputDir: "test-results/admin",
    reporter: [["list"], ["html", { outputFolder: "playwright-report/admin", open: "never" }]],
    use: { baseURL: config.baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
    projects: [{ name: "admin-chromium", use: { ...devices["Desktop Chrome"] } }],
    webServer: {
      command: "pnpm exec next start .tmp/admin-storefront-e2e --hostname localhost --port 3300",
      env: {
        ...offlineStoreEnvironment,
        ADMIN_E2E: "true",
        ADMIN_LIBRARY_ENABLED: "true",
        ADMIN_OWNER_EMAIL: config.ownerEmail,
        ADMIN_SETUP_SECRET: config.setupSecret,
        SUPABASE_SECRET_KEY: config.secretKey,
        NEXT_PUBLIC_SUPABASE_URL: config.authURL,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: config.publishableKey,
        DATABASE_URL: config.databaseUrl,
        DATABASE_SSL_CA: "",
        NEXT_PUBLIC_SITE_URL: config.baseURL,
        PRIVATE_BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_adminfixtures_synthetic-test-only-token",
        PRINTIFY_API_TOKEN: "",
        PRINTIFY_DRAFTS_API_TOKEN: "",
        // Read-only published catalog for the Featured order journey; provider tokens stay empty.
        PRINTIFY_SHOP_ID: "123",
        PRINTIFY_PUBLISHING_API_TOKEN: "",
        PRINTIFY_PUBLISHING_ENABLED: "true",
        PRINTIFY_FULFILLMENT_ENABLED: "false",
        STRIPE_SECRET_KEY: "",
        STRIPE_WEBHOOK_SECRET: "",
        STRIPE_TAX_ENABLED: "false",
        SIGNUP_CONFIRMATIONS_ENABLED: "true",
        VERCEL_ENV: "production",
        RESEND_API_KEY: "signup-confirmation-fixture",
        ORDER_ALERT_FROM_EMAIL: "drops@example.test",
        DROP_EMAIL_FROM_EMAIL: "",
        DROP_EMAILS_ENABLED: "false",
        NODE_OPTIONS: "--import=tsx --import=./e2e/admin/mock-private-blob.ts",
      },
      url: `${config.baseURL}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  }
}
