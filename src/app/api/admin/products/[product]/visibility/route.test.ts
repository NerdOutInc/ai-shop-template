// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { PUT } from "./route"

const { getAdminActor, setProductHidden, revalidateTag, revalidatePath, env } = vi.hoisted(() => ({
  getAdminActor: vi.fn(),
  setProductHidden: vi.fn(),
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  env: { VERCEL_ENV: "production", VERCEL_URL: "preview.vercel.app" },
}))
vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidateTag, revalidatePath }))
vi.mock("@/features/admin/get-admin-actor.server", () => ({ getAdminActor }))
vi.mock("@/features/publishing/get-publishing-store.server", () => ({
  getPublishingStore: () => ({ setProductHidden }),
}))
vi.mock("@/lib/env", () => ({ env }))
vi.mock("@/lib/get-site-url", () => ({ getSiteUrl: () => new URL("https://store.example") }))

function request(origin: string | null = "https://store.example", body: unknown = { hidden: true }, product = "tee-1") {
  return [
    new Request(`http://0.0.0.0:3000/api/admin/products/${product}/visibility`, {
      method: "PUT",
      headers: { ...(origin ? { origin } : {}), "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ product }) },
  ] as const
}
beforeEach(() => {
  vi.clearAllMocks()
  env.VERCEL_ENV = "production"
  getAdminActor.mockResolvedValue({ userId: "owner" })
  setProductHidden.mockResolvedValue({
    status: "saved",
    hiddenAt: "2026-09-21T00:00:00.000Z",
    revealAt: null,
    revealedAt: null,
    addedToShopAt: "2026-09-14T08:30:00.000Z",
  })
})

describe("product visibility route", () => {
  it.each([true, false])("saves hidden=%s and refreshes everything that lists products", async (hidden) => {
    const result = await PUT(...request("https://store.example", { hidden }))
    expect(result.status).toBe(200)
    expect(await result.json()).toEqual({
      productId: "tee-1",
      hidden,
      hiddenAt: "2026-09-21T00:00:00.000Z",
      revealAt: null,
      revealedAt: null,
      addedToShopAt: "2026-09-14T08:30:00.000Z",
    })
    expect(setProductHidden).toHaveBeenCalledWith("tee-1", hidden)
    expect(revalidateTag).toHaveBeenCalledWith("printify-published-catalog", { expire: 0 })
    // The sitemap and both merchant feeds render outside that tag.
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout")
    expect(result.headers.get("cache-control")).toContain("no-store")
  })

  // The Products page reads a missing field as a confirmation from an older release and keeps its own
  // guess, so "no arrival" has to arrive as an explicit null.
  it("sends a product with no recorded arrival as null rather than leaving the field out", async () => {
    setProductHidden.mockResolvedValue({
      status: "saved",
      hiddenAt: "2026-09-21T00:00:00.000Z",
      revealAt: null,
      revealedAt: null,
      addedToShopAt: null,
    })
    const result = await PUT(...request())
    expect(await result.json()).toHaveProperty("addedToShopAt", null)
  })

  it.each([null, "null", "https://foreign.example"])("denies origin %s before authentication", async (origin) => {
    expect((await PUT(...request(origin))).status).toBe(403)
    expect(getAdminActor).not.toHaveBeenCalled()
    expect(setProductHidden).not.toHaveBeenCalled()
  })

  it("permits the deployment origin only in a configured Vercel preview", async () => {
    expect((await PUT(...request("https://preview.vercel.app"))).status).toBe(403)
    env.VERCEL_ENV = "preview"
    expect((await PUT(...request("https://preview.vercel.app"))).status).toBe(200)
  })

  it("rejects a visitor before any change", async () => {
    getAdminActor.mockResolvedValue(null)
    expect((await PUT(...request())).status).toBe(401)
    expect(setProductHidden).not.toHaveBeenCalled()
    expect(revalidateTag).not.toHaveBeenCalled()
  })

  it.each([
    ["a missing field", {}],
    ["a non-boolean", { hidden: "yes" }],
    ["an unexpected field", { hidden: true, revealAt: "2026-09-21T00:00:00Z" }],
    ["a missing body", null],
  ])("rejects %s before any change", async (_label, body) => {
    expect((await PUT(...request("https://store.example", body))).status).toBe(400)
    expect(setProductHidden).not.toHaveBeenCalled()
  })

  it.each(["", "tee 1", "../../etc", "a".repeat(129)])(
    "reports the malformed product id %j as not found before any change",
    async (product) => {
      expect((await PUT(...request("https://store.example", { hidden: true }, product))).status).toBe(404)
      expect(setProductHidden).not.toHaveBeenCalled()
    }
  )

  it("reports an unpublished product as not found without refreshing the catalog", async () => {
    setProductHidden.mockResolvedValue("missing")
    expect((await PUT(...request())).status).toBe(404)
    expect(revalidateTag).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  // A refusal, not a staleness conflict: reloading never helps, finishing the garment does. The code
  // is what lets the Products page link to the garment instead of saying "try again".
  it("refuses to show a product whose garment is not set up, without refreshing the catalog", async () => {
    setProductHidden.mockResolvedValue("garment-incomplete")
    const result = await PUT(...request("https://store.example", { hidden: false }))
    expect(result.status).toBe(409)
    expect(await result.json()).toEqual({
      error:
        "This product's garment still needs a category and apparel details. Finish it under Garment models, then show it.",
      code: "GARMENT_INCOMPLETE",
    })
    expect(setProductHidden).toHaveBeenCalledWith("tee-1", false)
    expect(result.headers.get("cache-control")).toContain("no-store")
    expect(revalidateTag).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("reports a database outage as a retryable failure without exposing details", async () => {
    setProductHidden.mockRejectedValue(new Error("private database host"))
    const result = await PUT(...request())
    expect(result.status).toBe(503)
    expect(await result.text()).not.toContain("private database host")
    expect(revalidateTag).not.toHaveBeenCalled()
  })
})
