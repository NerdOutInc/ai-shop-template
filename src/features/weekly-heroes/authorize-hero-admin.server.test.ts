import { beforeEach, expect, it, vi } from "vitest"
vi.mock("server-only", () => ({}))

const actor = vi.hoisted(() => vi.fn())
const config = vi.hoisted(() => ({ enabled: true }))
vi.mock("@/lib/store-config", () => ({
  storeConfig: {
    features: {
      get designOfTheWeek() {
        return config.enabled
      },
    },
  },
}))
beforeEach(() => {
  config.enabled = true
})
vi.mock("@/features/admin/get-admin-actor.server", () => ({ getAdminActor: actor }))
vi.mock("@/lib/env", () => ({ env: { VERCEL_ENV: "production" } }))
vi.mock("@/lib/get-site-url", () => ({ getSiteUrl: () => new URL("https://store.test") }))
import { authorizeHeroAdmin } from "./authorize-hero-admin.server"
it("requires current admin membership for reads and writes", async () => {
  actor.mockResolvedValue(null)
  for (const method of ["GET", "PUT", "POST"]) {
    const result = await authorizeHeroAdmin(
      new Request("https://store.test/api/admin/weekly-heroes", { method, headers: { Origin: "https://store.test" } })
    )
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(401)
    expect((result as Response).headers.get("cache-control")).toContain("no-store")
  }
})
it("rejects cross-origin writes before any authentication or upload", async () => {
  const result = await authorizeHeroAdmin(
    new Request("https://store.test/api/admin/weekly-heroes", {
      method: "PUT",
      headers: { Origin: "https://attacker.test" },
    })
  )
  expect((result as Response).status).toBe(403)
  expect(actor).not.toHaveBeenCalled()
})

it("denies all hero operations when the weekly feature is disabled", async () => {
  config.enabled = false
  actor.mockResolvedValue({ userId: "admin" })
  for (const method of ["GET", "POST", "PUT", "DELETE"]) {
    const response = await authorizeHeroAdmin(new Request("https://store.test/api/admin/weekly-heroes", { method }))
    expect((response as Response).status).toBe(404)
  }
  expect(actor).not.toHaveBeenCalled()
})
