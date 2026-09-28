import { describe, expect, it, vi } from "vitest"
import { createServerClient } from "@supabase/ssr"
import { createAdminServerClient } from "./create-admin-server-client.server"

const state = vi.hoisted(() => ({ local: false, set: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: state.set }) }))
vi.mock("./get-admin-auth-config.server", () => ({
  getAdminAuthConfig: () => ({ url: "https://auth.example.test", key: "public-fixture" }),
}))
vi.mock("./is-admin-local-development", () => ({ isAdminLocalDevelopment: () => state.local }))
vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn() }))

describe("server auth cookies", () => {
  it.each([false, true])("passes the explicit secure policy to Supabase (local: %s)", async (local) => {
    state.local = local
    await createAdminServerClient()
    expect(createServerClient).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ cookieOptions: { secure: !local } })
    )
  })
})
