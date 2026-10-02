import { offlineStoreEnvironment } from "../offline-store-environment"

const port = Number(process.env.COMMERCE_E2E_PORT ?? 34100)
const providerPort = Number(process.env.COMMERCE_PROVIDER_PORT ?? 34200)

export const commerceTestConfig = {
  port,
  providerPort,
  baseURL: `http://127.0.0.1:${port}`,
  providerURL: `http://127.0.0.1:${providerPort}`,
  databaseUrl: process.env.CATALOG_E2E_DATABASE_URL ?? "",
  stripeKey: "sk_live_commerce_fixture_never_a_real_key",
  webhookSecret: "whsec_commerce_fixture_never_a_real_secret",
  printifyToken: "commerce-fixture-never-a-real-token",
  resendKey: "commerce-confirmation-fixture-never-a-real-key",
  environment: {
    ...offlineStoreEnvironment,
    VERCEL: "",
    VERCEL_ENV: "production",
    SIGNUP_CONFIRMATIONS_ENABLED: "true",
    // Offline browser projects share one identity; production-default limits have dedicated DB tests.
    SIGNUP_CONFIRMATIONS_HOURLY_LIMIT: "60",
    RESEND_API_KEY: "commerce-confirmation-fixture-never-a-real-key",
    ORDER_ALERT_FROM_EMAIL: "drops@example.test",
    COMMERCE_E2E: "true",
    CHECKOUT_RATE_LIMIT_SECRET: "commerce-local-only-rate-limit-secret-123456789",
    NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${port}`,
    DATABASE_URL: process.env.CATALOG_E2E_DATABASE_URL ?? "",
    PRINTIFY_SHOP_ID: "123",
    PRINTIFY_API_TOKEN: "commerce-fixture-never-a-real-token",
    PRINTIFY_PUBLISHING_ENABLED: "true",
    PRINTIFY_FULFILLMENT_ENABLED: "true",
    STRIPE_SECRET_KEY: "sk_live_commerce_fixture_never_a_real_key",
    STRIPE_WEBHOOK_SECRET: "whsec_commerce_fixture_never_a_real_secret",
    NODE_OPTIONS: "--import=tsx --import=./e2e/commerce/mock-providers.ts",
  },
}
