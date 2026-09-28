import { defineConfig, devices } from "@playwright/test"

import { publishingBrowserConfig } from "./e2e/publishing/browser-config"
import { adminBrowserConfig } from "./e2e/admin/browser-config"
import { offlineStoreEnvironment } from "./e2e/offline-store-environment"
import { merchantFeedPassword } from "./e2e/merchant-feed-password"

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100)
const baseURL = `http://127.0.0.1:${port}`
const fixturePort = Number(process.env.PLAYWRIGHT_FIXTURE_PORT ?? 3200)

export default defineConfig(
  process.env.ADMIN_E2E === "true"
    ? adminBrowserConfig()
    : process.env.PUBLISHING_E2E === "true"
      ? publishingBrowserConfig()
      : {
          testDir: "./e2e",
          testIgnore: ["**/publishing/**", "**/admin/**"],
          fullyParallel: true,
          forbidOnly: Boolean(process.env.CI),
          retries: process.env.CI ? 2 : 0,
          workers: process.env.CI ? 2 : undefined,
          reporter: [["list"], ["html", { open: "never" }]],
          use: {
            baseURL,
            trace: "retain-on-failure",
            screenshot: "only-on-failure",
          },
          projects: [
            { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
            { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
            { name: "desktop-webkit", use: { ...devices["Desktop Safari"] } },
          ],
          webServer: [
            {
              command: `pnpm exec next start .tmp/unconfigured-storefront-e2e --hostname 127.0.0.1 --port ${port}`,
              // Keep browser journeys offline even when a developer has configured a real shop locally.
              env: offlineStoreEnvironment,
              url: `${baseURL}/api/health`,
              reuseExistingServer: false,
              timeout: 60_000,
            },
            {
              command: `node --conditions=react-server --import tsx e2e/prepare-catalog.ts && pnpm exec next start .tmp/storefront-e2e --hostname 127.0.0.1 --port ${fixturePort}`,
              env: {
                ...offlineStoreEnvironment,
                DATABASE_URL: process.env.CATALOG_E2E_DATABASE_URL ?? "",
                CATALOG_E2E_DATABASE_URL: process.env.CATALOG_E2E_DATABASE_URL ?? "",
                PRINTIFY_PUBLISHING_ENABLED: "true",
                PRINTIFY_API_TOKEN: "e2e-fixture-token",
                PRINTIFY_SHOP_ID: "123",
                // The merchant feeds are the reveal gate's highest-stakes consumer: a withheld
                // product left in them is a policy violation, so give the fixture real credentials.
                GOOGLE_MERCHANT_FEED_PASSWORD: merchantFeedPassword,
                META_CATALOG_FEED_PASSWORD: merchantFeedPassword,
                NODE_OPTIONS: "--import=./e2e/mock-printify.ts",
              },
              url: `http://127.0.0.1:${fixturePort}/api/health`,
              reuseExistingServer: false,
              timeout: 60_000,
            },
          ],
        }
)
