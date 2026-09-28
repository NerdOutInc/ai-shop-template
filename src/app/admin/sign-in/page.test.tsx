import { redirect } from "next/navigation"
import { describe, expect, it, vi } from "vitest"
import AdminSignInPage from "./page"

vi.mock("@/lib/env", () => ({ env: { ADMIN_LIBRARY_ENABLED: true } }))
vi.mock("@/features/admin/get-admin-actor.server", () => ({
  getAdminActor: async () => ({ userId: "verified-admin" }),
}))
vi.mock("@/features/admin/get-admin-auth-config.server", () => ({ getAdminAuthConfig: () => null }))
vi.mock("@/features/admin/admin-sign-in-form", () => ({ AdminSignInForm: () => null }))
vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error("redirect")
  }),
}))

describe("authenticated sign-in page", () => {
  it("keeps a validated order destination for an already signed-in owner", async () => {
    const returnTo = "/admin/orders?order=6224014e-39f1-4dfb-9198-824768f4b53f"
    await expect(AdminSignInPage({ searchParams: Promise.resolve({ returnTo }) })).rejects.toThrow("redirect")
    expect(redirect).toHaveBeenCalledWith(returnTo)
  })
  it("redirects to an existing account route", async () => {
    await expect(AdminSignInPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect")
    expect(redirect).toHaveBeenCalledWith("/admin/concepts")
  })
})
