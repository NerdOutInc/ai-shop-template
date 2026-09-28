import { describe, expect, it, vi } from "vitest"
import { createBrowserClient } from "@supabase/ssr"
import { createAdminBrowserClient } from "./create-admin-browser-client"

const state = vi.hoisted(() => ({ local: false }))
vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://auth.example.test",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-fixture",
  },
}))
vi.mock("./is-admin-local-development", () => ({ isAdminLocalDevelopment: () => state.local }))
vi.mock("@supabase/ssr", () => ({ createBrowserClient: vi.fn() }))

describe("browser auth cookies", () => {
  it.each([false, true])("passes the explicit secure policy to Supabase (local: %s)", (local) => {
    state.local = local
    createAdminBrowserClient()
    expect(createBrowserClient).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ cookieOptions: { secure: !local } })
    )
  })
})
