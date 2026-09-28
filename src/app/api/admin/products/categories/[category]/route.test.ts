// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { DELETE, PUT } from "./route"

const { getAdminActor, renameCategory, deleteCategory, revalidateTag, revalidatePath, env } = vi.hoisted(() => ({
  getAdminActor: vi.fn(),
  renameCategory: vi.fn(),
  deleteCategory: vi.fn(),
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  env: { VERCEL_ENV: "production", VERCEL_URL: "preview.vercel.app" },
}))
vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidateTag, revalidatePath }))
vi.mock("@/features/admin/get-admin-actor.server", () => ({ getAdminActor }))
vi.mock("@/features/publishing/get-publishing-store.server", () => ({
  getPublishingStore: () => ({ garments: { renameCategory, deleteCategory } }),
}))
vi.mock("@/lib/env", () => ({ env }))
vi.mock("@/lib/get-site-url", () => ({ getSiteUrl: () => new URL("https://store.example") }))

function rename(
  origin: string | null = "https://store.example",
  body: unknown = { name: "Cropped tees" },
  category = "crop-tops"
) {
  return [
    new Request(`http://0.0.0.0:3000/api/admin/products/categories/${category}`, {
      method: "PUT",
      headers: { ...(origin ? { origin } : {}), "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ category }) },
  ] as const
}
function remove(origin: string | null = "https://store.example", category = "crop-tops") {
  return [
    new Request(`http://0.0.0.0:3000/api/admin/products/categories/${category}`, {
      method: "DELETE",
      headers: origin ? { origin } : {},
    }),
    { params: Promise.resolve({ category }) },
  ] as const
}
// Shapes commerce.shop_categories.slug can never hold, so no store call could find them.
const malformedSlugs = ["", "Crop-Tops", "crop tops", "crop--tops", "-crop", "crop-", "../../etc", "a".repeat(65)]

beforeEach(() => {
  vi.clearAllMocks()
  env.VERCEL_ENV = "production"
  getAdminActor.mockResolvedValue({ userId: "owner" })
  renameCategory.mockResolvedValue("saved")
  deleteCategory.mockResolvedValue("saved")
})

function expectStorefrontRefresh() {
  expect(revalidateTag).toHaveBeenCalledExactlyOnceWith("printify-published-catalog", { expire: 0 })
  expect(revalidatePath).toHaveBeenCalledExactlyOnceWith("/", "layout")
}

function expectNoStorefrontRefresh() {
  expect(revalidateTag).not.toHaveBeenCalled()
  expect(revalidatePath).not.toHaveBeenCalled()
}

describe("renaming a category", () => {
  it("saves the new name under the same slug and refreshes the storefront", async () => {
    const result = await PUT(...rename())
    expect(result.status).toBe(200)
    expect(await result.json()).toEqual({ slug: "crop-tops", name: "Cropped tees" })
    expect(renameCategory).toHaveBeenCalledWith("crop-tops", "Cropped tees")
    expect(result.headers.get("cache-control")).toContain("no-store")
    expectStorefrontRefresh()
  })

  // The table refuses a padded name, and that refusal would reach the owner as a 503.
  it("stores the trimmed name", async () => {
    const result = await PUT(...rename("https://store.example", { name: "  Cropped tees " }))
    expect(await result.json()).toEqual({ slug: "crop-tops", name: "Cropped tees" })
    expect(renameCategory).toHaveBeenCalledWith("crop-tops", "Cropped tees")
  })

  it.each([null, "null", "https://foreign.example"])("denies origin %s before authentication", async (origin) => {
    expect((await PUT(...rename(origin))).status).toBe(403)
    expect(getAdminActor).not.toHaveBeenCalled()
    expect(renameCategory).not.toHaveBeenCalled()
    expectNoStorefrontRefresh()
  })

  it("permits the deployment origin only in a configured Vercel preview", async () => {
    expect((await PUT(...rename("https://preview.vercel.app"))).status).toBe(403)
    env.VERCEL_ENV = "preview"
    expect((await PUT(...rename("https://preview.vercel.app"))).status).toBe(200)
  })

  it("rejects a visitor before any change", async () => {
    getAdminActor.mockResolvedValue(null)
    expect((await PUT(...rename())).status).toBe(401)
    expect(renameCategory).not.toHaveBeenCalled()
    expectNoStorefrontRefresh()
  })

  it.each([
    ["a missing name", {}],
    ["a blank name", { name: "  " }],
    ["a name past sixty characters", { name: "a".repeat(61) }],
    ["a non-string name", { name: 7 }],
    // The slug is the identity and becomes URL state. A rename must never be able to move it.
    ["a slug change", { name: "Cropped tees", slug: "cropped-tees" }],
    ["a missing body", null],
  ])("rejects %s before any change", async (_label, body) => {
    const result = await PUT(...rename("https://store.example", body))
    expect(result.status).toBe(400)
    expect(await result.json()).toEqual({ error: "Give the category a name." })
    expect(renameCategory).not.toHaveBeenCalled()
    expectNoStorefrontRefresh()
  })

  it.each(malformedSlugs)("reports the malformed category %j as not found before any change", async (category) => {
    const result = await PUT(...rename("https://store.example", { name: "Cropped tees" }, category))
    expect(result.status).toBe(404)
    expect(await result.json()).toEqual({ error: "Category not found." })
    expect(renameCategory).not.toHaveBeenCalled()
    expectNoStorefrontRefresh()
  })

  it("reports a category deleted in another tab as not found", async () => {
    renameCategory.mockResolvedValue("missing")
    const result = await PUT(...rename())
    expect(result.status).toBe(404)
    expect(await result.json()).toEqual({ error: "That category no longer exists." })
  })

  it("reports a name another category already has as a conflict", async () => {
    renameCategory.mockResolvedValue("taken")
    const result = await PUT(...rename())
    expect(result.status).toBe(409)
    expect(await result.json()).toEqual({ error: "A category with that name already exists." })
    expectNoStorefrontRefresh()
  })

  it("reports a database outage as a retryable failure without exposing details", async () => {
    renameCategory.mockRejectedValue(new Error("private database host"))
    const result = await PUT(...rename())
    expect(result.status).toBe(503)
    expect(await result.text()).not.toContain("private database host")
    expectNoStorefrontRefresh()
    expect(result.headers.get("cache-control")).toContain("no-store")
  })
})

describe("deleting a category", () => {
  it("deletes the category the path names and refreshes the storefront", async () => {
    const result = await DELETE(...remove())
    expect(result.status).toBe(200)
    expect(await result.json()).toEqual({ deleted: true })
    expect(deleteCategory).toHaveBeenCalledWith("crop-tops")
    expect(result.headers.get("cache-control")).toContain("no-store")
    expectStorefrontRefresh()
  })

  it.each([null, "null", "https://foreign.example"])("denies origin %s before authentication", async (origin) => {
    expect((await DELETE(...remove(origin))).status).toBe(403)
    expect(getAdminActor).not.toHaveBeenCalled()
    expect(deleteCategory).not.toHaveBeenCalled()
    expectNoStorefrontRefresh()
  })

  it("permits the deployment origin only in a configured Vercel preview", async () => {
    expect((await DELETE(...remove("https://preview.vercel.app"))).status).toBe(403)
    env.VERCEL_ENV = "preview"
    expect((await DELETE(...remove("https://preview.vercel.app"))).status).toBe(200)
  })

  it("rejects a visitor before any change", async () => {
    getAdminActor.mockResolvedValue(null)
    expect((await DELETE(...remove())).status).toBe(401)
    expect(deleteCategory).not.toHaveBeenCalled()
    expectNoStorefrontRefresh()
  })

  it.each(malformedSlugs)("reports the malformed category %j as not found before any change", async (category) => {
    const result = await DELETE(...remove("https://store.example", category))
    expect(result.status).toBe(404)
    expect(await result.json()).toEqual({ error: "Category not found." })
    expect(deleteCategory).not.toHaveBeenCalled()
    expectNoStorefrontRefresh()
  })

  it("reports a category already deleted as not found", async () => {
    deleteCategory.mockResolvedValue("missing")
    const result = await DELETE(...remove())
    expect(result.status).toBe(404)
    expect(await result.json()).toEqual({ error: "That category no longer exists." })
  })

  it.each([
    [1, "1 garment still uses this category. Move it to another category first."],
    [2, "2 garments still use this category. Move them to another category first."],
  ])("refuses a category %i garment(s) still use, and says how many", async (garments, error) => {
    deleteCategory.mockResolvedValue({ status: "in-use", garments })
    const result = await DELETE(...remove())
    expect(result.status).toBe(409)
    expect(await result.json()).toEqual({ error, garments })
    expectNoStorefrontRefresh()
  })

  it("reports a database outage as a retryable failure without exposing details", async () => {
    deleteCategory.mockRejectedValue(new Error("private database host"))
    const result = await DELETE(...remove())
    expect(result.status).toBe(503)
    expect(await result.text()).not.toContain("private database host")
    expectNoStorefrontRefresh()
  })
})
