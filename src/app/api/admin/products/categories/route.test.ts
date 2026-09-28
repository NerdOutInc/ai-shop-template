// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { POST, PUT } from "./route"

const { getAdminActor, createCategory, reorderCategories, revalidateTag, revalidatePath, env } = vi.hoisted(() => ({
  getAdminActor: vi.fn(),
  createCategory: vi.fn(),
  reorderCategories: vi.fn(),
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  env: { VERCEL_ENV: "production", VERCEL_URL: "preview.vercel.app" },
}))
vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidateTag, revalidatePath }))
vi.mock("@/features/admin/get-admin-actor.server", () => ({ getAdminActor }))
vi.mock("@/features/publishing/get-publishing-store.server", () => ({
  getPublishingStore: () => ({ garments: { createCategory, reorderCategories } }),
}))
vi.mock("@/lib/env", () => ({ env }))
vi.mock("@/lib/get-site-url", () => ({ getSiteUrl: () => new URL("https://store.example") }))

function request(method: "POST" | "PUT", origin: string | null, body: unknown) {
  return new Request("http://0.0.0.0:3000/api/admin/products/categories", {
    method,
    headers: { ...(origin ? { origin } : {}), "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}
const create = (origin: string | null = "https://store.example", body: unknown = { name: "Long sleeves" }) =>
  request("POST", origin, body)
const reorder = (
  origin: string | null = "https://store.example",
  body: unknown = { categorySlugs: ["tank-tops", "t-shirts"] }
) => request("PUT", origin, body)

beforeEach(() => {
  vi.clearAllMocks()
  env.VERCEL_ENV = "production"
  getAdminActor.mockResolvedValue({ userId: "owner" })
  createCategory.mockImplementation(async (input: { slug: string; name: string }) => ({
    status: "saved",
    category: { ...input, garmentCount: 0 },
  }))
  reorderCategories.mockResolvedValue("saved")
})

function expectStorefrontRefresh() {
  expect(revalidateTag).toHaveBeenCalledExactlyOnceWith("printify-published-catalog", { expire: 0 })
  expect(revalidatePath).toHaveBeenCalledExactlyOnceWith("/", "layout")
}

function expectNoStorefrontRefresh() {
  expect(revalidateTag).not.toHaveBeenCalled()
  expect(revalidatePath).not.toHaveBeenCalled()
}

describe("creating a category", () => {
  it("saves the category under a slug made from its name and refreshes the storefront", async () => {
    const result = await POST(create())
    expect(result.status).toBe(200)
    expect(await result.json()).toEqual({ category: { slug: "long-sleeves", name: "Long sleeves", garmentCount: 0 } })
    expect(createCategory).toHaveBeenCalledWith({ slug: "long-sleeves", name: "Long sleeves" })
    expect(result.headers.get("cache-control")).toContain("no-store")
    expectStorefrontRefresh()
  })

  // The table refuses a padded name, and that refusal would reach the owner as a 503.
  it("stores the trimmed name", async () => {
    await POST(create("https://store.example", { name: "  Crop Tops  " }))
    expect(createCategory).toHaveBeenCalledWith({ slug: "crop-tops", name: "Crop Tops" })
  })

  it.each([null, "null", "https://foreign.example"])("denies origin %s before authentication", async (origin) => {
    expect((await POST(create(origin))).status).toBe(403)
    expect(getAdminActor).not.toHaveBeenCalled()
    expect(createCategory).not.toHaveBeenCalled()
    expectNoStorefrontRefresh()
  })

  it("permits the deployment origin only in a configured Vercel preview", async () => {
    expect((await POST(create("https://preview.vercel.app"))).status).toBe(403)
    env.VERCEL_ENV = "preview"
    expect((await POST(create("https://preview.vercel.app"))).status).toBe(200)
  })

  it("rejects a visitor before any change", async () => {
    getAdminActor.mockResolvedValue(null)
    expect((await POST(create())).status).toBe(401)
    expect(createCategory).not.toHaveBeenCalled()
    expectNoStorefrontRefresh()
  })

  it.each([
    ["a missing name", {}],
    ["a blank name", { name: "   " }],
    ["a name past sixty characters", { name: "a".repeat(61) }],
    ["a non-string name", { name: 7 }],
    // The slug is the identity and is made here. A client does not get to choose it.
    ["a chosen slug", { name: "Hoodies", slug: "hoodies" }],
    ["a missing body", null],
  ])("rejects %s before any change", async (_label, body) => {
    const result = await POST(create("https://store.example", body))
    expect(result.status).toBe(400)
    expect(await result.json()).toEqual({ error: "Give the category a name." })
    expect(createCategory).not.toHaveBeenCalled()
    expectNoStorefrontRefresh()
  })

  it.each(["!!!", "日本語", "🧗"])("asks for a name a URL can spell instead of saving %j", async (name) => {
    const result = await POST(create("https://store.example", { name }))
    expect(result.status).toBe(400)
    expect(await result.json()).toEqual({ error: "Give the category a name." })
    expect(createCategory).not.toHaveBeenCalled()
    expectNoStorefrontRefresh()
  })

  it("reports a name that is already taken as a conflict", async () => {
    createCategory.mockResolvedValue({ status: "taken" })
    const result = await POST(create())
    expect(result.status).toBe(409)
    expect(await result.json()).toEqual({ error: "A category with that name already exists." })
    expectNoStorefrontRefresh()
  })

  it("reports a database outage as a retryable failure without exposing details", async () => {
    createCategory.mockRejectedValue(new Error("private database host"))
    const result = await POST(create())
    expect(result.status).toBe(503)
    expect(await result.text()).not.toContain("private database host")
    expectNoStorefrontRefresh()
    expect(result.headers.get("cache-control")).toContain("no-store")
  })
})

describe("reordering categories", () => {
  it("saves the whole list in its new order and refreshes the storefront", async () => {
    const result = await PUT(reorder())
    expect(result.status).toBe(200)
    expect(await result.json()).toEqual({ saved: true })
    expect(reorderCategories).toHaveBeenCalledWith(["tank-tops", "t-shirts"])
    expect(result.headers.get("cache-control")).toContain("no-store")
    expectStorefrontRefresh()
  })

  it.each([null, "null", "https://foreign.example"])("denies origin %s before authentication", async (origin) => {
    expect((await PUT(reorder(origin))).status).toBe(403)
    expect(getAdminActor).not.toHaveBeenCalled()
    expect(reorderCategories).not.toHaveBeenCalled()
    expectNoStorefrontRefresh()
  })

  it("permits the deployment origin only in a configured Vercel preview", async () => {
    expect((await PUT(reorder("https://preview.vercel.app"))).status).toBe(403)
    env.VERCEL_ENV = "preview"
    expect((await PUT(reorder("https://preview.vercel.app"))).status).toBe(200)
  })

  it("rejects a visitor before any change", async () => {
    getAdminActor.mockResolvedValue(null)
    expect((await PUT(reorder())).status).toBe(401)
    expect(reorderCategories).not.toHaveBeenCalled()
    expectNoStorefrontRefresh()
  })

  it.each([
    ["no categories", { categorySlugs: [] }],
    [
      "more than a hundred categories",
      { categorySlugs: Array.from({ length: 101 }, (_, index) => `category-${index}`) },
    ],
    ["a name where a slug belongs", { categorySlugs: ["Tank Tops"] }],
    ["a slug past sixty-four characters", { categorySlugs: ["a".repeat(65)] }],
    ["a non-string slug", { categorySlugs: [7] }],
    ["an unexpected field", { categorySlugs: ["t-shirts"], position: 1 }],
    ["a missing body", null],
  ])("rejects %s before any change", async (_label, body) => {
    const result = await PUT(reorder("https://store.example", body))
    expect(result.status).toBe(400)
    expect(await result.json()).toEqual({ error: "List every category in its new order." })
    expect(reorderCategories).not.toHaveBeenCalled()
    expectNoStorefrontRefresh()
  })

  it("reports a changed category list as a conflict the owner can reload from", async () => {
    reorderCategories.mockResolvedValue("changed")
    const result = await PUT(reorder())
    expect(result.status).toBe(409)
    expect(await result.json()).toEqual({ error: "The categories changed. Reload to sort the latest list." })
    expectNoStorefrontRefresh()
  })

  it("reports a database outage as a retryable failure without exposing details", async () => {
    reorderCategories.mockRejectedValue(new Error("private database host"))
    const result = await PUT(reorder())
    expect(result.status).toBe(503)
    expect(await result.text()).not.toContain("private database host")
    expectNoStorefrontRefresh()
  })
})
