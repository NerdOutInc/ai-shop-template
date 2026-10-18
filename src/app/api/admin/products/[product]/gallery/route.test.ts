import { beforeEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ actor: vi.fn(), read: vi.fn(), save: vi.fn(), activate: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("@/features/admin/get-admin-actor.server", () => ({ getAdminActor: mocks.actor }))
vi.mock("@/features/product-gallery/read-gallery-editor.server", () => ({ readGalleryEditor: mocks.read }))
vi.mock("@/features/product-gallery/get-product-gallery-store.server", () => ({
  getProductGalleryStore: () => ({ save: mocks.save }),
}))
vi.mock("@/features/product-gallery/activate-product-gallery.server", () => ({
  activateProductGallery: mocks.activate,
}))
vi.mock("@/lib/env", () => ({ env: { VERCEL_ENV: "production" } }))
vi.mock("@/lib/get-site-url", () => ({ getSiteUrl: () => new URL("https://store.example") }))
import { GET, POST } from "./route"
const context = { params: Promise.resolve({ product: "sample-tee" }) }
beforeEach(() => vi.resetAllMocks())
it("requires current active membership and never exposes draft data to visitors", async () => {
  mocks.actor.mockResolvedValue(null)
  for (const [method, handler] of [
    ["GET", GET],
    ["POST", POST],
  ] as const) {
    const response = await handler(
      new Request("https://store.example/api/admin/products/sample-tee/gallery", {
        method,
        headers: { origin: "https://store.example" },
      }),
      context
    )
    expect(response.status).toBe(401)
    expect(response.headers.get("cache-control")).toContain("no-store")
  }
  expect(mocks.read).not.toHaveBeenCalled()
  expect(mocks.save).not.toHaveBeenCalled()
  expect(mocks.activate).not.toHaveBeenCalled()
})
it("refuses cross-origin mutation before reading private state", async () => {
  mocks.actor.mockResolvedValue({ userId: "owner" })
  const response = await POST(
    new Request("https://store.example/api/admin/products/sample-tee/gallery", {
      method: "POST",
      headers: { origin: "https://attacker.example" },
    }),
    context
  )
  expect(response.status).toBe(403)
  expect(mocks.actor).not.toHaveBeenCalled()
  expect(mocks.save).not.toHaveBeenCalled()
})
it("dispatches activation and saves only from a same-origin JSON request", async () => {
  mocks.actor.mockResolvedValue({ userId: "owner" })
  mocks.activate.mockResolvedValue({ status: "preparing", completed: 1, total: 2 })
  const body = {
    action: "activate",
    revision: "e3a4e34c-cb28-442e-8741-bef56b70b97d",
    productRevision: "1",
    confirmations: {},
  }
  const post = (contentType: string) =>
    POST(
      new Request("https://store.example/api/admin/products/sample-tee/gallery", {
        method: "POST",
        headers: { origin: "https://store.example", "content-type": contentType },
        body: JSON.stringify(body),
      }),
      context
    )
  const response = await post("application/json")
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ status: "preparing", completed: 1, total: 2 })
  expect(mocks.activate).toHaveBeenCalledWith("sample-tee", body, "owner")
  expect((await post("text/plain")).status).toBe(400)
  expect(mocks.activate).toHaveBeenCalledTimes(1)
  expect(mocks.save).not.toHaveBeenCalled()
})
