import { devices, type PlaywrightTestConfig } from "@playwright/test"

import { offlineStoreEnvironment } from "../offline-store-environment"

import { publishingTestConfig as config } from "./publishing-test-config"

export function publishingBrowserConfig(): PlaywrightTestConfig {
  const database = new URL(config.databaseUrl ?? "http://missing-database")
  if (
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    !["localhost", "127.0.0.1"].includes(database.hostname) ||
    database.pathname !== "/store_publishing_e2e" ||
    database.search
  )
    throw new Error("PUBLISHING_E2E_DATABASE_URL must use the isolated local store_publishing_e2e database")
  return {
    testDir: "./e2e/publishing",
    fullyParallel: false,
    forbidOnly: Boolean(process.env.CI),
    workers: 1,
    retries: 0,
    timeout: 60_000,
    expect: { timeout: 15_000 },
    outputDir: "test-results/publishing",
    reporter: [["list"], ["html", { outputFolder: "playwright-report/publishing", open: "never" }]],
    use: { baseURL: config.baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
    projects: [
      { name: "publishing-desktop", use: { ...devices["Desktop Chrome"] } },
      { name: "publishing-narrow", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
    ],
    webServer: [
      {
        command: "node --import tsx e2e/publishing/provider-server.ts",
        env: { PUBLISHING_E2E: "true" },
        url: `${config.providerURL}/health`,
        reuseExistingServer: false,
      },
      {
        command: `pnpm exec next start .tmp/storefront-e2e --hostname 127.0.0.1 --port ${config.port}`,
        env: {
          ...offlineStoreEnvironment,
          ADMIN_LIBRARY_ENABLED: "false",
          ADMIN_SETUP_SECRET: "",
          SUPABASE_SECRET_KEY: "",
          PRIVATE_BLOB_READ_WRITE_TOKEN: "",
          PUBLISHING_E2E: "true",
          DATABASE_URL: config.databaseUrl!,
          PRINTIFY_SHOP_ID: config.shopId,
          PRINTIFY_API_TOKEN: config.readToken,
          PRINTIFY_PUBLISHING_API_TOKEN: config.writeToken,
          PRINTIFY_PUBLISHING_ENABLED: "true",
          PRINTIFY_WEBHOOK_SECRET: config.webhookSecret,
          CRON_SECRET: config.cronSecret,
          PRINTIFY_MONITOR_SECRET: config.monitorSecret,
          GOOGLE_MERCHANT_FEED_PASSWORD: config.merchantFeedPassword,
          META_CATALOG_FEED_PASSWORD: config.metaFeedPassword,
          BLOB_READ_WRITE_TOKEN: config.blobToken,
          VERCEL_BLOB_API_URL: `${config.providerURL}/blob`,
          NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST: config.blobHost,
          NEXT_PUBLIC_SITE_URL: config.canonicalURL,
          CHECKOUT_RATE_LIMIT_SECRET: "publishing-e2e-checkout-capacity-fixture-secret",
          STRIPE_SECRET_KEY: "sk_test_publishing_fixture",
          STRIPE_WEBHOOK_SECRET: "whsec_publishing_fixture",
          STRIPE_TAX_ENABLED: "false",
          PRINTIFY_FULFILLMENT_ENABLED: "false",
          NODE_OPTIONS: "--import=tsx --import=./e2e/publishing/mock-publishing-provider.ts",
        },
        url: `${config.baseURL}/api/health`,
        reuseExistingServer: false,
        timeout: 60_000,
      },
    ],
  }
}
