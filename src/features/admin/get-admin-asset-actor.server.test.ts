// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest"
import { AuthRetryableFetchError, AuthApiError } from "@supabase/supabase-js"
import { getAdminAssetActor } from "./get-admin-asset-actor.server"
const { getClaims, getUser, env, getAdminAuthConfig } = vi.hoisted(() => ({
  getClaims: vi.fn(),
  getUser: vi.fn(),
  env: { ADMIN_LIBRARY_ENABLED: true },
  getAdminAuthConfig: vi.fn(),
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/env", () => ({ env }))
vi.mock("./get-admin-auth-config.server", () => ({ getAdminAuthConfig }))
vi.mock("./create-admin-server-client.server", () => ({
  createAdminServerClient: async () => ({ auth: { getClaims, getUser } }),
}))
const userId = "ba68c007-e7dd-4eb7-b7bb-41ba8343c6e0",
  sessionId = "13b70f66-7aab-4b93-a00a-b1f0253d8b28"
beforeEach(() => {
  vi.clearAllMocks()
  env.ADMIN_LIBRARY_ENABLED = true
  getAdminAuthConfig.mockReturnValue({ url: "https://auth.example", key: "public" })
  getClaims.mockResolvedValue({
    data: { claims: { sub: userId, session_id: sessionId, role: "authenticated" } },
    error: null,
  })
})
it("verifies the signed identity and carries the session into the database check without an Auth user fetch", async () => {
  expect(await getAdminAssetActor()).toEqual({ userId, sessionId })
  expect(getClaims).toHaveBeenCalledOnce()
  expect(getUser).not.toHaveBeenCalled()
})
it.each([
  {},
  { sub: userId },
  { sub: userId, session_id: "invalid", role: "authenticated" },
  { sub: userId, session_id: sessionId, role: "anon" },
])("rejects claims without a usable authenticated session", async (claims) => {
  getClaims.mockResolvedValue({ data: { claims }, error: null })
  expect(await getAdminAssetActor()).toBeNull()
})
it("rejects invalid signatures and an unavailable feature", async () => {
  getClaims.mockResolvedValue({ data: null, error: new Error("bad signature") })
  expect(await getAdminAssetActor()).toBeNull()
  getClaims.mockClear()
  env.ADMIN_LIBRARY_ENABLED = false
  expect(await getAdminAssetActor()).toBeNull()
  expect(getClaims).not.toHaveBeenCalled()
})
it("does not disguise an infrastructure failure as an invalid credential", async () => {
  getClaims.mockRejectedValue(new Error("connection unavailable"))
  await expect(getAdminAssetActor()).rejects.toThrow("connection unavailable")
})

it.each([new AuthRetryableFetchError("retry", 0), new AuthApiError("unavailable", 503, undefined)])(
  "propagates transient Auth errors returned through the SDK result",
  async (error) => {
    getClaims.mockResolvedValue({ data: null, error })
    await expect(getAdminAssetActor()).rejects.toBe(error)
  }
)
