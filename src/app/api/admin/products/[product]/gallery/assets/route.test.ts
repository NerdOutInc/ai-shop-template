import { beforeEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ actor: vi.fn(), upload: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("@/features/admin/get-admin-actor.server", () => ({ getAdminActor: mocks.actor }))
vi.mock("@/features/product-gallery/upload-gallery-photo.server", () => ({ uploadGalleryPhoto: mocks.upload }))
vi.mock("@/lib/env", () => ({ env: { VERCEL_ENV: "production" } }))
vi.mock("@/lib/get-site-url", () => ({ getSiteUrl: () => new URL("https://store.example") }))
import { POST } from "./route"
beforeEach(() => vi.resetAllMocks())
it("refuses anonymous and cross-origin uploads before reading or storing private bytes", async () => {
  for (const [origin, actor, status] of [
    ["https://store.example", null, 401],
    ["https://attacker.example", { userId: "owner" }, 403],
  ] as const) {
    mocks.actor.mockResolvedValue(actor)
    const response = await POST(
      new Request("https://store.example/api/admin/products/sample-tee/gallery/assets", {
        method: "POST",
        headers: { origin },
        body: "not an image",
      }),
      { params: Promise.resolve({ product: "sample-tee" }) }
    )
    expect(response.status).toBe(status)
    expect(response.headers.get("cache-control")).toContain("no-store")
  }
  expect(mocks.upload).not.toHaveBeenCalled()
})
