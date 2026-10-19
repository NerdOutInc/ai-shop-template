import { assertIsolatedDatabase } from "../../test/assert-isolated-database"
import { devices, type PlaywrightTestConfig } from "@playwright/test"

import { commerceTestConfig as config } from "./test-config"

export function commerceBrowserConfig(): PlaywrightTestConfig {
  assertIsolatedDatabase(config.databaseUrl, "store_catalog_e2e")

  return {
    testDir: "./e2e/commerce",
    fullyParallel: true,
    forbidOnly: Boolean(process.env.CI),
    workers: 2,
    retries: 0,
    timeout: 45_000,
    reporter: [["list"], ["html", { outputFolder: "playwright-report/commerce", open: "never" }]],
    outputDir: "test-results/commerce",
    use: { baseURL: config.baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
    projects: [
      { name: "commerce-desktop", use: { ...devices["Desktop Chrome"] } },
      { name: "commerce-phone", use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } } },
    ],
    webServer: [
      {
        command: "node --import tsx e2e/commerce/provider-server.ts",
        env: { COMMERCE_E2E: "true" },
        url: `${config.providerURL}/health`,
        reuseExistingServer: false,
      },
      {
        command: `node --conditions=react-server --import tsx e2e/prepare-catalog.ts && pnpm exec next start .tmp/commerce-storefront-e2e --hostname 127.0.0.1 --port ${config.port}`,
        env: config.environment,
        url: `${config.baseURL}/api/health`,
        reuseExistingServer: false,
        timeout: 60_000,
      },
    ],
  }
}
