import { render, screen } from "@testing-library/react"
import { redirect } from "next/navigation"
import { describe, expect, it, vi } from "vitest"
import AdminSetupPage from "./page"

const fixture = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/env", () => ({
  env: {
    ADMIN_LIBRARY_ENABLED: true,
    DATABASE_URL: "postgres://store_app_runtime:private-password@db.example.test:5432/postgres?sslmode=verify-full",
    ADMIN_OWNER_EMAIL: "owner@example.test",
    ADMIN_SETUP_SECRET: "one-time-setup-secret",
    SUPABASE_SECRET_KEY: "service-role-secret",
  },
}))
vi.mock("@/features/admin/get-admin-auth-config.server", () => ({ getAdminAuthConfig: () => ({}) }))
vi.mock("@/features/admin/get-admin-database.server", () => ({ getAdminDatabase: () => ({ query: fixture.query }) }))
vi.mock("@/features/admin/admin-sign-in-form", () => ({ AdminSignInForm: () => <div>Owner setup form</div> }))
vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  redirect: vi.fn(() => {
    // Next signals a redirect by throwing an error that carries a digest.
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/admin/sign-in;307;" })
  }),
}))

describe("owner setup page database failures", () => {
  it("stays unconfigured and logs the reason code and coarse cause when the role lacks privileges", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
    fixture.query.mockRejectedValue(
      Object.assign(new Error("permission denied for schema private"), {
        code: "42501",
        internalQuery: "select exists(select 1 from public.admin_memberships where active) as has_admin",
      })
    )
    render(await AdminSetupPage())
    expect(screen.getByRole("heading", { name: "Set up your store studio" })).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("database migration")
    expect(screen.queryByText("Owner setup form")).not.toBeInTheDocument()
    expect(log.mock.calls).toEqual([
      ["Admin library unavailable", { code: "ADMIN_SETUP_STATUS_UNAVAILABLE", cause: "permission-denied" }],
    ])
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/permission denied|private|select|password|postgres/)
    expect(redirect).not.toHaveBeenCalled()
  })

  it("rethrows the sign-in redirect for a claimed store without logging a failure", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
    fixture.query.mockResolvedValue({ rows: [{ has_admin: true, consumed: true }] })
    await expect(AdminSetupPage()).rejects.toThrow("NEXT_REDIRECT")
    expect(redirect).toHaveBeenCalledWith("/admin/sign-in")
    expect(log).not.toHaveBeenCalled()
  })

  it("withholds the setup form and logs missing enrollment columns", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
    fixture.query.mockRejectedValue(Object.assign(new Error("private enrollment column query"), { code: "42703" }))
    render(await AdminSetupPage())
    expect(screen.queryByText("Owner setup form")).not.toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("database migration")
    expect(log.mock.calls).toEqual([
      ["Admin library unavailable", { code: "ADMIN_SETUP_STATUS_UNAVAILABLE", cause: "missing-relation" }],
    ])
  })

  it("offers owner setup when the database reports an unclaimed store", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
    fixture.query.mockResolvedValue({ rows: [{ has_admin: false, consumed: false }] })
    render(await AdminSetupPage())
    expect(screen.getByText("Owner setup form")).toBeInTheDocument()
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
    expect(log).not.toHaveBeenCalled()
  })
})
