import { render, screen } from "@testing-library/react"
import { notFound } from "next/navigation"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { getAdminActor } from "@/features/admin/get-admin-actor.server"
import { GalleryError } from "@/features/product-gallery/gallery-error"
import { readGalleryEditor } from "@/features/product-gallery/read-gallery-editor.server"

import ProductPhotosPage, { metadata } from "./page"

vi.mock("server-only", () => ({}))
vi.mock("next/server", () => ({ connection: vi.fn() }))
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
}))
vi.mock("@/features/admin/get-admin-actor.server", () => ({ getAdminActor: vi.fn() }))
vi.mock("@/features/product-gallery/read-gallery-editor.server", () => ({ readGalleryEditor: vi.fn() }))
vi.mock("./_components/product-photo-editor", () => ({
  ProductPhotoEditor: ({ initial }: { initial: { title: string } }) => <h1>Editing {initial.title}</h1>,
}))
const props = (id = "sample-tee") => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => undefined)
  vi.mocked(getAdminActor).mockResolvedValue({ userId: "admin" })
})

describe("admin product photos page", () => {
  it("hides the editor from visitors without an active admin session", async () => {
    vi.mocked(getAdminActor).mockResolvedValue(null)
    await expect(ProductPhotosPage(props())).rejects.toThrow("NEXT_NOT_FOUND")
    expect(readGalleryEditor).not.toHaveBeenCalled()
  })

  it("rejects malformed product ids before reading the gallery", async () => {
    await expect(ProductPhotosPage(props("../orders"))).rejects.toThrow("NEXT_NOT_FOUND")
    expect(readGalleryEditor).not.toHaveBeenCalled()
  })

  it("uses a 404 for products the gallery store cannot find", async () => {
    vi.mocked(readGalleryEditor).mockRejectedValue(new GalleryError("Product not found.", 404))
    await expect(ProductPhotosPage(props())).rejects.toThrow("NEXT_NOT_FOUND")
    expect(notFound).toHaveBeenCalledOnce()
  })

  it("renders the private editor with a return link and noindex metadata", async () => {
    vi.mocked(readGalleryEditor).mockResolvedValue({ title: "Sample tee" } as never)
    render(await ProductPhotosPage(props("sample-tee")))
    expect(readGalleryEditor).toHaveBeenCalledWith("sample-tee")
    expect(screen.getByRole("heading", { name: "Editing Sample tee" })).toBeVisible()
    expect(screen.getByRole("link", { name: "Back to product preview" })).toHaveAttribute(
      "href",
      "/admin/products/sample-tee"
    )
    expect(metadata).toMatchObject({ title: "Product photos", robots: { index: false, follow: false } })
  })

  it("explains what to check when the migration or configuration is missing", async () => {
    vi.mocked(readGalleryEditor).mockRejectedValue(Object.assign(new Error("relation missing"), { code: "42P01" }))
    render(await ProductPhotosPage(props()))
    expect(screen.getByRole("heading", { name: "Product photos are unavailable" })).toBeVisible()
    expect(screen.getByRole("alert")).toHaveTextContent("database migration and publishing configuration")
    expect(console.error).toHaveBeenCalledWith("Product gallery operation failed", { code: "GALLERY_SCHEMA_MISSING" })
  })
})
