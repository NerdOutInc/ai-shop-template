// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { PUT } from "./route"

const { getAdminActor, reorderProducts, revalidateTag, env } = vi.hoisted(() => ({
  getAdminActor: vi.fn(),
  reorderProducts: vi.fn(),
  revalidateTag: vi.fn(),
  env: { VERCEL_ENV: "production", VERCEL_URL: "preview.vercel.app" },
}))
vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidateTag }))
vi.mock("@/features/admin/get-admin-actor.server", () => ({ getAdminActor }))
vi.mock("@/features/publishing/get-publishing-store.server", () => ({
  getPublishingStore: () => ({ reorderProducts }),
}))
vi.mock("@/lib/env", () => ({ env }))
vi.mock("@/lib/get-site-url", () => ({ getSiteUrl: () => new URL("https://store.example") }))

function request(origin: string | null = "https://store.example", body: unknown = { productIds: ["tee-2", "tee-1"] }) {
  return new Request("http://0.0.0.0:3000/api/admin/products/featured-order", {
    method: "PUT",
    headers: { ...(origin ? { origin } : {}), "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  env.VERCEL_ENV = "production"
  getAdminActor.mockResolvedValue({ userId: "owner" })
  reorderProducts.mockResolvedValue("saved")
})

describe("featured order route", () => {
  it("saves the order and refreshes the storefront catalog", async () => {
    const result = await PUT(request())
    expect(result.status).toBe(200)
    expect(await result.json()).toEqual({ saved: true })
    expect(reorderProducts).toHaveBeenCalledWith(["tee-2", "tee-1"])
    expect(revalidateTag).toHaveBeenCalledWith("printify-published-catalog", { expire: 0 })
    expect(result.headers.get("cache-control")).toContain("no-store")
  })

  it.each([null, "null", "https://foreign.example"])("denies origin %s before authentication", async (origin) => {
    expect((await PUT(request(origin))).status).toBe(403)
    expect(getAdminActor).not.toHaveBeenCalled()
    expect(reorderProducts).not.toHaveBeenCalled()
  })

  it("permits the deployment origin only in a configured Vercel preview", async () => {
    expect((await PUT(request("https://preview.vercel.app"))).status).toBe(403)
    env.VERCEL_ENV = "preview"
    expect((await PUT(request("https://preview.vercel.app"))).status).toBe(200)
  })

  it("rejects a visitor before any change", async () => {
    getAdminActor.mockResolvedValue(null)
    expect((await PUT(request())).status).toBe(401)
    expect(reorderProducts).not.toHaveBeenCalled()
    expect(revalidateTag).not.toHaveBeenCalled()
  })

  it.each([
    ["no products", { productIds: [] }],
    ["an empty product id", { productIds: [""] }],
    ["a non-string product id", { productIds: [7] }],
    ["an unexpected field", { productIds: ["tee-1"], position: 1 }],
    ["a missing body", null],
  ])("rejects %s before any change", async (_label, body) => {
    expect((await PUT(request("https://store.example", body))).status).toBe(400)
    expect(reorderProducts).not.toHaveBeenCalled()
  })

  it("reports a changed lineup as a conflict without refreshing the catalog", async () => {
    reorderProducts.mockResolvedValue("changed")
    const result = await PUT(request())
    expect(result.status).toBe(409)
    expect(revalidateTag).not.toHaveBeenCalled()
  })

  it("reports a database outage as a retryable failure without exposing details", async () => {
    reorderProducts.mockRejectedValue(new Error("private database host"))
    const result = await PUT(request())
    expect(result.status).toBe(503)
    expect(await result.text()).not.toContain("private database host")
    expect(revalidateTag).not.toHaveBeenCalled()
  })
})
