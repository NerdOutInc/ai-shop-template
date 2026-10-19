// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

it.each([
  "postgresql://user:password@db.example.com:5432/postgres?sslmode=require",
  "postgresql://user:password@db.example.com:6543/postgres?sslmode=verify-full",
  "postgresql://user:password@localhost:5432/postgres?host=db.example.com",
])("reports an unsafe runtime database URL as checkout not configured: %s", async (databaseUrl) => {
  vi.stubEnv("DATABASE_URL", databaseUrl)
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_configuration_fixture")
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_configuration_fixture")
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000")
  const { getCommerceServices } = await import("./get-commerce-services.server")
  const { CheckoutError } = await import("./checkout-error")
  expect(getCommerceServices).toThrow(CheckoutError)
  expect(getCommerceServices).toThrow(expect.objectContaining({ code: "NOT_CONFIGURED" }))
})
