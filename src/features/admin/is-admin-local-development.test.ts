import { afterEach, describe, expect, it, vi } from "vitest"
import { isAdminLocalDevelopment } from "./is-admin-local-development"

const state = vi.hoisted(() => ({ siteUrl: undefined as string | undefined }))
vi.mock("@/lib/env", () => ({
  env: {
    get NEXT_PUBLIC_SITE_URL() {
      return state.siteUrl
    },
  },
}))
afterEach(() => vi.unstubAllEnvs())

describe("HTTP-compatible admin cookies are limited to local development", () => {
  it.each(["http://localhost:3100", "http://127.0.0.1:3100", "http://[::1]:3100"])(
    "allows explicitly configured %s even in production-mode tests",
    (siteUrl) => {
      vi.stubEnv("NODE_ENV", "production")
      state.siteUrl = siteUrl
      expect(isAdminLocalDevelopment()).toBe(true)
    }
  )
  it.each([
    "https://localhost",
    "https://store.example.test",
    "http://store.example.test",
    "http://localhost.example.test",
  ])("requires Secure cookies for %s even in development", (siteUrl) => {
    vi.stubEnv("NODE_ENV", "development")
    state.siteUrl = siteUrl
    expect(isAdminLocalDevelopment()).toBe(false)
  })
  it("defaults to Secure outside unconfigured local development", () => {
    state.siteUrl = undefined
    vi.stubEnv("NODE_ENV", "production")
    expect(isAdminLocalDevelopment()).toBe(false)
    vi.stubEnv("NODE_ENV", "development")
    expect(isAdminLocalDevelopment()).toBe(true)
  })
})
