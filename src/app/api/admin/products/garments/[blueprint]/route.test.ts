// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { PUT } from "./route"

const { getAdminActor, saveGarment, revalidateTag, revalidatePath, env } = vi.hoisted(() => ({
  getAdminActor: vi.fn(),
  saveGarment: vi.fn(),
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  env: { VERCEL_ENV: "production", VERCEL_URL: "preview.vercel.app" },
}))
vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidateTag, revalidatePath }))
vi.mock("@/features/admin/get-admin-actor.server", () => ({ getAdminActor }))
vi.mock("@/features/publishing/get-publishing-store.server", () => ({
  getPublishingStore: () => ({ garments: { saveGarment } }),
}))
vi.mock("@/lib/env", () => ({ env }))
vi.mock("@/lib/get-site-url", () => ({ getSiteUrl: () => new URL("https://store.example") }))

const setup = {
  manufacturer: "Next Level",
  model: "5080",
  categorySlug: "crop-tops",
  googleProductCategory: 212,
  gender: "female",
  ageGroup: "adult",
  sizeSystem: "US",
}
// A garment added ahead of time: named, with nothing else chosen yet.
const bare = {
  ...setup,
  categorySlug: null,
  googleProductCategory: null,
  gender: null,
  ageGroup: null,
  sizeSystem: null,
}

function request(origin: string | null = "https://store.example", body: unknown = setup, blueprint = "1312") {
  return [
    new Request(`http://0.0.0.0:3000/api/admin/products/garments/${blueprint}`, {
      method: "PUT",
      headers: { ...(origin ? { origin } : {}), "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ blueprint }) },
  ] as const
}
beforeEach(() => {
  vi.clearAllMocks()
  env.VERCEL_ENV = "production"
  getAdminActor.mockResolvedValue({ userId: "owner" })
  saveGarment.mockResolvedValue("saved")
})

function expectStorefrontRefresh() {
  expect(revalidateTag).toHaveBeenCalledExactlyOnceWith("printify-published-catalog", { expire: 0 })
  expect(revalidatePath).toHaveBeenCalledExactlyOnceWith("/", "layout")
}

function expectNoStorefrontRefresh() {
  expect(revalidateTag).not.toHaveBeenCalled()
  expect(revalidatePath).not.toHaveBeenCalled()
}

describe("garment setup route", () => {
  it("saves the whole setup under the blueprint's number and refreshes the storefront", async () => {
    const result = await PUT(...request())
    expect(result.status).toBe(200)
    expect(await result.json()).toEqual({ blueprintId: 1312 })
    expect(saveGarment).toHaveBeenCalledWith(1312, setup)
    expect(result.headers.get("cache-control")).toContain("no-store")
    expectStorefrontRefresh()
  })

  it("saves a garment that has a name and nothing else chosen yet", async () => {
    expect((await PUT(...request("https://store.example", bare))).status).toBe(200)
    expect(saveGarment).toHaveBeenCalledWith(1312, bare)
  })

  // The table refuses a padded name, and that refusal would reach the owner as a 503.
  it("stores the trimmed manufacturer and model", async () => {
    await PUT(...request("https://store.example", { ...setup, manufacturer: " Next Level ", model: " 5080 " }))
    expect(saveGarment).toHaveBeenCalledWith(1312, setup)
  })

  it.each([null, "null", "https://foreign.example"])("denies origin %s before authentication", async (origin) => {
    expect((await PUT(...request(origin))).status).toBe(403)
    expect(getAdminActor).not.toHaveBeenCalled()
    expect(saveGarment).not.toHaveBeenCalled()
    expectNoStorefrontRefresh()
  })

  it("permits the deployment origin only in a configured Vercel preview", async () => {
    expect((await PUT(...request("https://preview.vercel.app"))).status).toBe(403)
    env.VERCEL_ENV = "preview"
    expect((await PUT(...request("https://preview.vercel.app"))).status).toBe(200)
  })

  it("rejects a visitor before any change", async () => {
    getAdminActor.mockResolvedValue(null)
    expect((await PUT(...request())).status).toBe(401)
    expect(saveGarment).not.toHaveBeenCalled()
    expectNoStorefrontRefresh()
  })

  it.each([
    // An omitted key would let a client that forgot a field clear it.
    ["an omitted key", { ...setup, sizeSystem: undefined }],
    ["a blank manufacturer", { ...setup, manufacturer: "  " }],
    ["a model past eighty characters", { ...setup, model: "a".repeat(81) }],
    ["an empty string where null is meant", { ...setup, categorySlug: "" }],
    ["a category name where a slug belongs", { ...setup, categorySlug: "Crop Tops" }],
    ["a Google category sent as text", { ...setup, googleProductCategory: "212" }],
    ["a Google category of zero", { ...setup, googleProductCategory: 0 }],
    ["a gender outside the feed's list", { ...setup, gender: "women" }],
    ["an age group outside the feed's list", { ...setup, ageGroup: "teen" }],
    ["a size system outside the feed's list", { ...setup, sizeSystem: "USA" }],
    // Complete is the table's generated column. Nobody gets to assert it.
    ["a claim to be complete", { ...setup, complete: true }],
    ["a blueprint number in the body", { ...setup, blueprintId: 1317 }],
    ["a pasted catalog link", { ...setup, url: "https://printify.com/app/products/1312" }],
    ["a missing body", null],
  ])("rejects %s before any change", async (_label, body) => {
    const result = await PUT(...request("https://store.example", body))
    expect(result.status).toBe(400)
    expect(await result.json()).toEqual({ error: "Check the garment's name, category and apparel details." })
    expect(saveGarment).not.toHaveBeenCalled()
    expectNoStorefrontRefresh()
  })

  it.each(["", "0", "01317", "-1317", "13.17", "1e3", "0x525", "1317abc", "1234567890", "../../etc"])(
    "reports the malformed blueprint %j as not found before any change",
    async (blueprint) => {
      const result = await PUT(...request("https://store.example", setup, blueprint))
      expect(result.status).toBe(404)
      expect(await result.json()).toEqual({ error: "Garment not found." })
      expect(saveGarment).not.toHaveBeenCalled()
      expectNoStorefrontRefresh()
    }
  )

  it("reports a category deleted in another tab as not found", async () => {
    saveGarment.mockResolvedValue("invalid-category")
    const result = await PUT(...request())
    expect(result.status).toBe(404)
    expect(await result.json()).toEqual({ error: "That category no longer exists. Reload and choose another." })
    expectNoStorefrontRefresh()
  })

  it.each([
    [1, "1 product on this garment is in the shop or scheduled. Hide it before clearing its setup."],
    [3, "3 products on this garment are in the shop or scheduled. Hide them before clearing its setup."],
  ])("refuses to clear a setup %i product(s) on the wall depend on, and says how many", async (products, error) => {
    saveGarment.mockResolvedValue({ status: "in-use", products })
    const result = await PUT(...request("https://store.example", bare))
    expect(result.status).toBe(409)
    expect(await result.json()).toEqual({ error, products })
    expectNoStorefrontRefresh()
  })

  it("reports a database outage as a retryable failure without exposing details", async () => {
    saveGarment.mockRejectedValue(new Error("private database host"))
    const result = await PUT(...request())
    expect(result.status).toBe(503)
    expect(await result.text()).not.toContain("private database host")
    expectNoStorefrontRefresh()
    expect(result.headers.get("cache-control")).toContain("no-store")
  })
})
