// @vitest-environment node
import "../../../test/configured-store"
import { storeConfig } from "@/lib/store-config"
import { beforeEach, expect, it, vi } from "vitest"
import { readSignupConfirmationSetup } from "./read-signup-confirmation-setup.server"
const { env } = vi.hoisted(() => ({
  env: {
    SIGNUP_CONFIRMATIONS_ENABLED: "false",
    VERCEL_ENV: "production",
    NEXT_PUBLIC_SITE_URL: "https://fixture.example",
    DATABASE_URL: "configured",
    RESEND_API_KEY: "fixture",
    DROP_EMAIL_FROM_EMAIL: "drops@example.com",
    ORDER_ALERT_FROM_EMAIL: "owner@example.com",
  },
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/env", () => ({ env }))
beforeEach(() => {
  env.SIGNUP_CONFIRMATIONS_ENABLED = "true"
  env.VERCEL_ENV = "production"
  env.RESEND_API_KEY = "fixture"
})
it("requires explicit production activation and complete sender credentials", () => {
  expect(readSignupConfirmationSetup().sending).toBe(true)
  env.VERCEL_ENV = "preview"
  expect(readSignupConfirmationSetup().sending).toBe(false)
  env.VERCEL_ENV = "production"
  env.SIGNUP_CONFIRMATIONS_ENABLED = "false"
  expect(readSignupConfirmationSetup().sending).toBe(false)
  env.SIGNUP_CONFIRMATIONS_ENABLED = "true"
  env.RESEND_API_KEY = ""
  expect(readSignupConfirmationSetup().sending).toBe(false)
})

it("uses owner branding and refuses unreviewed policy or disabled list", () => {
  expect(readSignupConfirmationSetup().from).toBe(`${storeConfig.name} <drops@example.com>`)
  storeConfig.features.dropSignup = false
  expect(readSignupConfirmationSetup().sending).toBe(false)
  storeConfig.privacy.retainedDropSubscribers = true
  expect(readSignupConfirmationSetup().sending).toBe(true)
  storeConfig.policies.published = false
  expect(readSignupConfirmationSetup().sending).toBe(false)
})
