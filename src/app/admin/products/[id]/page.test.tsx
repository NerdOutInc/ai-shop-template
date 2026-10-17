import { render, screen } from "@testing-library/react"
import { notFound } from "next/navigation"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { getAdminCatalogProduct } from "@/features/catalog/get-admin-catalog-product.server"
import { normalizeCatalogProduct } from "@/features/catalog/normalize-catalog-product"
import { ProductDetails } from "@/features/catalog/product-details"

import AdminProductPreviewPage, { metadata } from "./page"

vi.mock("server-only", () => ({}))
vi.mock("next/server", () => ({ connection: vi.fn() }))
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
}))
vi.mock("@/features/catalog/get-admin-catalog-product.server", () => ({ getAdminCatalogProduct: vi.fn() }))
vi.mock("@/features/catalog/product-details", () => ({
  ProductDetails: vi.fn(() => <div>Shared product options</div>),
}))
vi.mock("./_components/google-merchant-copy-editor", () => ({
  GoogleMerchantCopyEditor: () => <section aria-label="Google Merchant copy editor" />,
}))
const props = { params: Promise.resolve({ id: "hidden-published-product" }) }

beforeEach(() => {
  vi.clearAllMocks()
})

describe("admin product preview page", () => {
  it("uses a404 for unauthorized, missing, or unpublished products", async () => {
    vi.mocked(getAdminCatalogProduct).mockResolvedValue({ status: "missing" })
    await expect(AdminProductPreviewPage(props)).rejects.toThrow("NEXT_NOT_FOUND")
    expect(notFound).toHaveBeenCalledOnce()
    expect(ProductDetails).not.toHaveBeenCalled()
  })

  it("renders the real product component in preview mode with a clear banner and return link", async () => {
    const product = normalizeCatalogProduct({
      id: "hidden-published-product",
      shop_id: 1234,
      title: "Published tee",
      variants: [],
      options: [],
      images: [],
    })
    vi.mocked(getAdminCatalogProduct).mockResolvedValue({ status: "ready", product, isNew: false })
    const { container } = render(await AdminProductPreviewPage(props))
    expect(screen.getByRole("complementary", { name: "Admin preview" })).toHaveTextContent("Only admins")
    expect(screen.getByRole("link", { name: "Back to shop lineup" })).toHaveAttribute("href", "/admin/products")
    expect(ProductDetails).toHaveBeenCalledWith({ product, preview: true }, undefined)
    expect(screen.getByRole("region", { name: "Google Merchant copy editor" })).toBeVisible()
    expect(container.querySelector('script[type="application/ld+json"]')).not.toBeInTheDocument()
    expect(metadata).toMatchObject({ title: "Product preview", robots: { index: false, follow: false } })
  })

  it("keeps a retry state when private storage is temporarily unavailable", async () => {
    vi.mocked(getAdminCatalogProduct).mockResolvedValue({ status: "unavailable" })
    render(await AdminProductPreviewPage(props))
    expect(screen.getByRole("heading", { name: "This preview is taking a breather." })).toBeVisible()
    expect(screen.getByRole("status")).toHaveTextContent("Please refresh")
    expect(ProductDetails).not.toHaveBeenCalled()
    expect(notFound).not.toHaveBeenCalled()
  })
})
