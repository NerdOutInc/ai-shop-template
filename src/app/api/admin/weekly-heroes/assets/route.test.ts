import { beforeEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ actor: vi.fn(), upload: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("@/features/admin/get-admin-actor.server", () => ({ getAdminActor: mocks.actor }))
vi.mock("@/features/weekly-heroes/upload-hero-image.server", () => ({ uploadHeroImage: mocks.upload }))
vi.mock("@/lib/env", () => ({ env: { VERCEL_ENV: "production" } }))
vi.mock("@/lib/get-site-url", () => ({ getSiteUrl: () => new URL("https://store.test") }))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.actor.mockResolvedValue(null)
})

import { POST } from "./route"
import { WeeklyHeroError } from "@/features/weekly-heroes/weekly-hero-error"
it("denies revoked or missing admins before uploading private bytes", async () => {
  const response = await POST(
    new Request("https://store.test/api/admin/weekly-heroes/assets?kind=desktop", {
      method: "POST",
      headers: { Origin: "https://store.test" },
    })
  )
  expect(response.status).toBe(401)
  expect(response.headers.get("cache-control")).toContain("no-store")
  expect(mocks.upload).not.toHaveBeenCalled()
})
it("rejects corrupt content as a 400 instead of suggesting an upload retry", async () => {
  mocks.actor.mockResolvedValue({ userId: "admin" })
  mocks.upload.mockRejectedValue(new WeeklyHeroError("Use a single PNG, JPEG or WebP image."))
  const response = await POST(
    new Request("https://store.test/api/admin/weekly-heroes/assets?kind=desktop", {
      method: "POST",
      headers: { Origin: "https://store.test" },
    })
  )
  expect(response.status).toBe(400)
  expect(await response.json()).toEqual({ error: "Use a single PNG, JPEG or WebP image." })
})
