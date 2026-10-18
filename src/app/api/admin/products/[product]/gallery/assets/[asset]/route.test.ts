import { beforeEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ actor: vi.fn(), asset: vi.fn(), bytes: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("@/features/admin/get-admin-actor.server", () => ({ getAdminActor: mocks.actor }))
vi.mock("@/features/product-gallery/get-product-gallery-store.server", () => ({
  getProductGalleryStore: () => ({ asset: mocks.asset }),
}))
vi.mock("@/features/product-gallery/read-gallery-photo.server", () => ({ readGalleryPhoto: mocks.bytes }))
vi.mock("@/lib/env", () => ({ env: { VERCEL_ENV: "production" } }))
vi.mock("@/lib/get-site-url", () => ({ getSiteUrl: () => new URL("https://store.example") }))
import { GET } from "./route"
const asset = "e3a4e34c-cb28-442e-8741-bef56b70b97d"
beforeEach(() => vi.resetAllMocks())
it("denies private previews without current membership and blocks cross-site reads", async () => {
  for (const [site, actor, status] of [
    ["same-origin", null, 401],
    ["cross-site", { userId: "owner" }, 403],
  ] as const) {
    mocks.actor.mockResolvedValue(actor)
    const response = await GET(
      new Request(`https://store.example/api/admin/products/sample-tee/gallery/assets/${asset}`, {
        headers: { "sec-fetch-site": site },
      }),
      { params: Promise.resolve({ product: "sample-tee", asset }) }
    )
    expect(response.status).toBe(status)
    expect(response.headers.get("cache-control")).toContain("no-store")
  }
  expect(mocks.asset).not.toHaveBeenCalled()
  expect(mocks.bytes).not.toHaveBeenCalled()
})
it("never reads bytes when an asset belongs to another product", async () => {
  mocks.actor.mockResolvedValue({ userId: "owner" })
  mocks.asset.mockImplementation(async (product) => (product === "owner-product" ? { id: asset } : null))
  const response = await GET(new Request(`https://store.example/api/admin/products/other/gallery/assets/${asset}`), {
    params: Promise.resolve({ product: "other", asset }),
  })
  expect(response.status).toBe(404)
  expect(mocks.asset).toHaveBeenCalledWith("other", asset)
  expect(mocks.bytes).not.toHaveBeenCalled()
})
it("rechecks membership and ownership before letting the browser reuse private bytes", async () => {
  mocks.actor.mockResolvedValue({ userId: "owner" })
  mocks.asset.mockResolvedValue({ id: asset, sha256: "a".repeat(64) })
  mocks.bytes.mockResolvedValue(Buffer.from("private fixture"))
  const url = `https://store.example/api/admin/products/sample-tee/gallery/assets/${asset}`
  const context = { params: Promise.resolve({ product: "sample-tee", asset }) }
  const initial = await GET(new Request(url), context)
  const headers = { "if-none-match": initial.headers.get("etag")! }
  expect(initial.headers.get("cache-control")).toBe("private, no-cache")
  expect(initial.headers.get("cdn-cache-control")).toBe("no-store")
  expect((await GET(new Request(url, { headers }), context)).status).toBe(304)
  expect(mocks.bytes).toHaveBeenCalledTimes(1)
  mocks.actor.mockResolvedValue(null)
  expect((await GET(new Request(url, { headers }), context)).status).toBe(401)
  mocks.actor.mockResolvedValue({ userId: "owner" })
  mocks.asset.mockResolvedValue(null)
  expect((await GET(new Request(url, { headers }), context)).status).toBe(404)
  expect(mocks.bytes).toHaveBeenCalledTimes(1)
})
it("logs a safe database reason without exposing private errors to logs or the response", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
  try {
    mocks.actor.mockResolvedValue({ userId: "owner" })
    mocks.asset.mockRejectedValue(Object.assign(new Error("private database credential"), { code: "42501" }))
    const response = await GET(
      new Request(`https://store.example/api/admin/products/sample-tee/gallery/assets/${asset}`),
      {
        params: Promise.resolve({ product: "sample-tee", asset }),
      }
    )
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain("credential")
    expect(log).toHaveBeenCalledWith("Product gallery operation failed", { code: "GALLERY_DATABASE_PERMISSION" })
  } finally {
    log.mockRestore()
  }
})
it("accepts weak, listed and wildcard validators only after rechecking access", async () => {
  mocks.actor.mockResolvedValue({ userId: "owner" })
  mocks.asset.mockResolvedValue({ id: asset, sha256: "b".repeat(64) })
  const url = `https://store.example/api/admin/products/sample-tee/gallery/assets/${asset}`
  const context = { params: Promise.resolve({ product: "sample-tee", asset }) }
  const etag = `"${"b".repeat(64)}"`
  for (const value of [`W/${etag}`, `"stale", ${etag}`, "*"]) {
    const response = await GET(new Request(url, { headers: { "if-none-match": value } }), context)
    expect(response.status).toBe(304)
    expect(response.headers.get("etag")).toBe(etag)
  }
  expect(mocks.asset).toHaveBeenCalledTimes(3)
  expect(mocks.bytes).not.toHaveBeenCalled()
})
it("rejects malformed photo ids before any lookup", async () => {
  mocks.actor.mockResolvedValue({ userId: "owner" })
  const response = await GET(
    new Request("https://store.example/api/admin/products/sample-tee/gallery/assets/not-a-uuid"),
    { params: Promise.resolve({ product: "sample-tee", asset: "not-a-uuid" }) }
  )
  expect(response.status).toBe(404)
  expect(response.headers.get("cache-control")).toContain("no-store")
  expect(mocks.asset).not.toHaveBeenCalled()
})
