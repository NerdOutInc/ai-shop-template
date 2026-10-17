import { beforeEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ actor: vi.fn(), read: vi.fn(), store: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("@/features/admin/get-admin-actor.server", () => ({ getAdminActor: mocks.actor }))
vi.mock("@/features/weekly-heroes/read-hero-image.server", () => ({ readHeroImage: mocks.read }))
vi.mock("@/features/weekly-heroes/get-weekly-hero-store.server", () => ({ getWeeklyHeroStore: mocks.store }))
vi.mock("@/lib/env", () => ({ env: { VERCEL_ENV: "production" } }))
vi.mock("@/lib/get-site-url", () => ({ getSiteUrl: () => new URL("https://store.test") }))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.actor.mockResolvedValue(null)
})
const id = "11111111-1111-4111-8111-111111111111"

import { GET } from "./route"
it("denies revoked or missing admins before reading private draft bytes", async () => {
  const response = await GET(new Request(`https://store.test/api/admin/weekly-heroes/assets/${id}`), {
    params: Promise.resolve({ id }),
  })
  expect(response.status).toBe(401)
  expect(response.headers.get("cache-control")).toContain("no-store")
  expect(mocks.read).not.toHaveBeenCalled()
  expect(mocks.store).not.toHaveBeenCalled()
})
