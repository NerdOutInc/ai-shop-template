// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { listCadenceSlots } from "@/features/publishing/list-cadence-slots"

import { DELETE, PUT } from "./route"

const { getAdminActor, schedule, remove, revalidateTag, revalidatePath, env } = vi.hoisted(() => ({
  getAdminActor: vi.fn(),
  schedule: vi.fn(),
  remove: vi.fn(),
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  env: { VERCEL_ENV: "production", VERCEL_URL: "preview.vercel.app" },
}))
vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidateTag, revalidatePath }))
vi.mock("@/features/admin/get-admin-actor.server", () => ({ getAdminActor }))
vi.mock("@/features/publishing/get-publishing-store.server", () => ({
  getPublishingStore: () => ({ productSchedule: { schedule, remove } }),
}))
vi.mock("@/lib/env", () => ({ env }))
vi.mock("@/lib/get-site-url", () => ({ getSiteUrl: () => new URL("https://store.example") }))

const liveAt = listCadenceSlots({ from: new Date(), count: 1 })[0]!.toISOString()
function request(
  body: unknown = { productIds: ["tee-a", "tee-b"], liveAt },
  origin: string | null = "https://store.example"
) {
  return new Request("http://0.0.0.0:3000/api/admin/product-schedule", {
    method: "PUT",
    headers: { ...(origin ? { origin } : {}), "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  env.VERCEL_ENV = "production"
  getAdminActor.mockResolvedValue({ userId: "owner" })
  schedule.mockResolvedValue({
    status: "saved",
    entries: [
      { id: "a", productId: "tee-a", liveAt },
      { id: "b", productId: "tee-b", liveAt },
    ],
    products: [
      { productId: "tee-a", hiddenAt: "2026-01-01T00:00:00.000Z", revealAt: liveAt, revealedAt: null },
      { productId: "tee-b", hiddenAt: null, revealAt: null, revealedAt: "2026-01-01T00:00:00.000Z" },
    ],
    now: Date.now(),
  })
  remove.mockResolvedValue({ outcome: "removed", entries: [], products: [], now: Date.now() })
})

describe("product schedule route", () => {
  it("saves one atomic product batch and invalidates all storefront consumers", async () => {
    const result = await PUT(request())
    expect(result.status).toBe(200)
    expect(result.headers.get("cache-control")).toContain("no-store")
    expect(await result.json()).toMatchObject({
      entries: expect.arrayContaining([
        expect.objectContaining({ productId: "tee-a" }),
        expect.objectContaining({ productId: "tee-b" }),
      ]),
      products: expect.arrayContaining([expect.objectContaining({ productId: "tee-a", revealAt: liveAt })]),
      now: expect.any(Number),
    })
    expect(schedule).toHaveBeenCalledWith({ productIds: ["tee-a", "tee-b"], liveAt, featuredBy: "owner" })
    expect(revalidateTag).toHaveBeenCalledWith("printify-published-catalog", { expire: 0 })
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout")
  })

  it.each([null, "https://attacker.example"])("refuses writes from %s before looking up an admin", async (origin) => {
    expect((await PUT(request(undefined, origin))).status).toBe(403)
    expect((await DELETE(request({ productId: "tee-a" }, origin))).status).toBe(403)
    expect(getAdminActor).not.toHaveBeenCalled()
    expect(schedule).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it("requires an admin for both operations", async () => {
    getAdminActor.mockResolvedValue(null)
    expect((await PUT(request())).status).toBe(401)
    expect((await DELETE(request({ productId: "tee-a" }))).status).toBe(401)
    expect(schedule).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it.each([
    { productIds: [], liveAt },
    { productIds: ["tee-a", "tee-a"], liveAt },
    { productIds: ["tee-a"], liveAt: new Date(Date.now() + 60_000).toISOString() },
    { productIds: ["tee-a"], liveAt: listCadenceSlots({ from: new Date(), count: 7 })[6]!.toISOString() },
    { productIds: ["tee-a"], liveAt, arbitrary: true },
  ])("refuses an invalid batch or date", async (body) => {
    expect((await PUT(request(body))).status).toBe(400)
    expect(schedule).not.toHaveBeenCalled()
  })

  it.each(["missing", "garment-incomplete", "past"])(
    "reports %s without invalidating a failed batch",
    async (status) => {
      schedule.mockResolvedValue({ status, productIds: ["tee-a"] })
      expect((await PUT(request())).status).toBe(409)
      expect(revalidateTag).not.toHaveBeenCalled()
    }
  )

  it("removes the future feature and refreshes catalog visibility", async () => {
    expect((await DELETE(request({ productId: "tee-a" }))).status).toBe(200)
    expect(remove).toHaveBeenCalledExactlyOnceWith("tee-a")
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout")
  })

  it("reports an already-started feature with its current membership and actual visibility", async () => {
    const now = Date.now()
    const startedAt = new Date(now - 1000).toISOString()
    const receipt = {
      outcome: "current",
      now,
      entries: [{ id: "a", productId: "tee-a", liveAt: startedAt }],
      products: [{ productId: "tee-a", hiddenAt: "2026-01-01T00:00:00.000Z", revealAt: startedAt, revealedAt: null }],
    }
    remove.mockResolvedValue(receipt)
    const response = await DELETE(request({ productId: "tee-a" }))
    expect(await response.json()).toEqual({ saved: true, ...receipt })
  })

  it("returns a safe storage error", async () => {
    schedule.mockRejectedValue(new Error("private database host"))
    const result = await PUT(request())
    expect(result.status).toBe(503)
    expect(await result.text()).not.toContain("private database host")
  })
})
