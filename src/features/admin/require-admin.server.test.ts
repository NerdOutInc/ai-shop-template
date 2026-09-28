import { expect, it, vi } from "vitest"
import { redirect } from "next/navigation"
import { requireAdmin } from "./require-admin.server"
vi.mock("server-only", () => ({}))
vi.mock("@/lib/env", () => ({ env: { ADMIN_LIBRARY_ENABLED: true } }))
vi.mock("./get-admin-actor.server", () => ({ getAdminActor: async () => null }))
vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error("redirect")
  }),
}))
it("preserves an exact order link through sign-in without relaxing authentication", async () => {
  const path = "/admin/orders?order=6224014e-39f1-4dfb-9198-824768f4b53f"
  await expect(requireAdmin(path)).rejects.toThrow("redirect")
  expect(redirect).toHaveBeenCalledWith(`/admin/sign-in?returnTo=${encodeURIComponent(path)}`)
})
it("does not forward an external or malformed return target", async () => {
  await expect(requireAdmin("https://evil.test")).rejects.toThrow("redirect")
  expect(redirect).toHaveBeenCalledWith("/admin/sign-in")
})
