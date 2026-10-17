import { beforeEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ actor: vi.fn(), store: vi.fn(), refresh: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("@/features/admin/get-admin-actor.server", () => ({ getAdminActor: mocks.actor }))
vi.mock("@/features/weekly-heroes/get-weekly-hero-store.server", () => ({ getWeeklyHeroStore: mocks.store }))
vi.mock("@/features/design-of-the-week/refresh-storefront.server", () => ({ refreshStorefront: mocks.refresh }))
vi.mock("@/lib/env", () => ({ env: { VERCEL_ENV: "production" } }))
vi.mock("@/lib/get-site-url", () => ({ getSiteUrl: () => new URL("https://store.test") }))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.actor.mockResolvedValue(null)
})
const id = "11111111-1111-4111-8111-111111111111"
const request = (method: string, body?: unknown) =>
  new Request("https://store.test/api/admin/weekly-heroes", {
    method,
    headers: { Origin: "https://store.test", "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

import { PUT, DELETE } from "./route"
it("denies revoked or missing admins before making any write", async () => {
  for (const response of [await PUT(request("PUT")), await DELETE(request("DELETE"))]) {
    expect(response.status).toBe(401)
    expect(response.headers.get("cache-control")).toContain("no-store")
  }
  expect(mocks.store).not.toHaveBeenCalled()
})
it("saves and withdraws hero revisions without invalidating product caches", async () => {
  mocks.actor.mockResolvedValue({ userId: "admin" })
  const draft = { version: id, scheduled: false, hero: null }
  const save = vi.fn().mockResolvedValue(draft),
    withdraw = vi.fn().mockResolvedValue(draft)
  mocks.store.mockReturnValue({ save, withdraw })
  const manifest = {
    title: "Sample release",
    alt: "A neutral product composition",
    offer: "",
    desktopAssetId: id,
    mobileAssetId: id,
    links: [
      {
        productId: "tee",
        label: "Shop tee",
        color: "",
        desktop: { x: 25, y: 0, width: 20, height: 20 },
        mobile: { x: 0, y: 0, width: 20, height: 20 },
      },
    ],
  }
  const put = await PUT(
    request("PUT", { liveAt: "2026-10-23T22:30:00.000Z", version: null, scheduled: false, manifest })
  )
  expect(put.status).toBe(200)
  expect(await put.json()).toEqual({ draft })
  const removed = await DELETE(request("DELETE", { liveAt: "2026-10-23T22:30:00.000Z", version: id }))
  expect(removed.status).toBe(200)
  expect(save).toHaveBeenCalledOnce()
  expect(withdraw).toHaveBeenCalledOnce()
  expect(mocks.refresh).not.toHaveBeenCalled()
})
