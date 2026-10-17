import { beforeEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ actor: vi.fn(), upload: vi.fn(), read: vi.fn(), store: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("@/features/admin/get-admin-actor.server", () => ({ getAdminActor: mocks.actor }))
vi.mock("@/features/weekly-heroes/upload-hero-image.server", () => ({ uploadHeroImage: mocks.upload }))
vi.mock("@/features/weekly-heroes/read-hero-image.server", () => ({ readHeroImage: mocks.read }))
vi.mock("@/features/weekly-heroes/get-weekly-hero-store.server", () => ({ getWeeklyHeroStore: mocks.store }))
vi.mock("@/features/design-of-the-week/refresh-storefront.server", () => ({ refreshStorefront: vi.fn() }))
vi.mock("@/lib/env", () => ({ env: { VERCEL_ENV: "production" } }))
vi.mock("@/lib/get-site-url", () => ({ getSiteUrl: () => new URL("https://store.test") }))
import { PUT, DELETE } from "./route"
import { POST } from "@/app/api/admin/weekly-heroes/assets/route"
import { GET } from "@/app/api/admin/weekly-heroes/assets/[id]/route"
beforeEach(() => mocks.actor.mockResolvedValue(null))
it("denies revoked or missing admins before reading draft bytes or making any write", async () => {
  const request = (method: string) =>
    new Request("https://store.test/api/admin/weekly-heroes", { method, headers: { Origin: "https://store.test" } })
  const results = [
    await PUT(request("PUT")),
    await DELETE(request("DELETE")),
    await POST(request("POST")),
    await GET(request("GET"), { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) }),
  ]
  for (const response of results) {
    expect(response.status).toBe(401)
    expect(response.headers.get("cache-control")).toContain("no-store")
  }
  expect(mocks.upload).not.toHaveBeenCalled()
  expect(mocks.read).not.toHaveBeenCalled()
  expect(mocks.store).not.toHaveBeenCalled()
})
