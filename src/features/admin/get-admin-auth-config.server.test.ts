import { beforeEach, describe, expect, it, vi } from "vitest"
import { getAdminAuthConfig } from "./get-admin-auth-config.server"

const config = vi.hoisted(() => ({ enabled: true, url: "https://project.supabase.co", key: "publishable" }))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/env", () => ({
  env: {
    get ADMIN_LIBRARY_ENABLED() {
      return config.enabled
    },
    get NEXT_PUBLIC_SUPABASE_URL() {
      return config.url
    },
    get NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY() {
      return config.key
    },
  },
}))

beforeEach(() => {
  config.enabled = true
  config.url = "https://project.supabase.co"
  config.key = "publishable"
})

describe("admin auth configuration boundary", () => {
  it.each(["https://project.supabase.co", "http://localhost:58621", "http://127.0.0.1:58621", "http://[::1]:58621"])(
    "accepts a secure or loopback root URL: %s",
    (url) => {
      config.url = url
      expect(getAdminAuthConfig()).toEqual({ url: new URL(url).toString(), key: "publishable" })
    }
  )
  it.each([
    "ftp://localhost",
    "ftp://127.0.0.1",
    "http://public.example",
    "https://user:password@project.supabase.co",
    "https://project.supabase.co/auth/v1",
    "https://project.supabase.co/?secret=hidden",
    "https://project.supabase.co/#fragment",
  ])("rejects an unsafe or ambiguous provider URL: %s", (url) => {
    config.url = url
    expect(getAdminAuthConfig()).toBeNull()
  })
  it("remains optional while the feature is disabled or credentials are absent", () => {
    config.enabled = false
    expect(getAdminAuthConfig()).toBeNull()
    config.enabled = true
    config.key = ""
    expect(getAdminAuthConfig()).toBeNull()
  })
})
