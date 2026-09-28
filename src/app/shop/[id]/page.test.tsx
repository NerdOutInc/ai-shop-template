import { render, screen } from "@testing-library/react"
import { notFound } from "next/navigation"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { getCatalogProduct } from "@/features/catalog/get-catalog-product.server"
import { normalizeCatalogProduct } from "@/features/catalog/normalize-catalog-product"
import { ProductDetails } from "@/features/catalog/product-details"

import ProductPage, { generateMetadata } from "./page"

vi.mock("server-only", () => ({}))
vi.mock("next/server", () => ({ connection: vi.fn() }))
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
}))
vi.mock("@/features/catalog/get-catalog-product.server", () => ({ getCatalogProduct: vi.fn() }))
vi.mock("@/features/catalog/product-details", () => ({
  ProductDetails: vi.fn(() => <div>Published product options</div>),
}))
const props = { params: Promise.resolve({ id: "published-product" }) }
beforeEach(() => {
  vi.clearAllMocks()
})

describe("product page publication reads", () => {
  it("renders the existing retry fallback during a database outage without issuing a404", async () => {
    vi.mocked(getCatalogProduct).mockResolvedValue({ status: "unavailable" })
    expect(await generateMetadata(props)).toEqual({ title: "Product" })
    render(await ProductPage(props))
    expect(screen.getByRole("heading", { name: "This product is taking a breather." })).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("Please refresh or come back soon.")
    expect(screen.getByRole("link", { name: "Back to shop" })).toHaveAttribute("href", "/shop")
    expect(notFound).not.toHaveBeenCalled()
  })

  it("keeps truly missing or unpublished products404 with matching metadata", async () => {
    vi.mocked(getCatalogProduct).mockResolvedValue({ status: "missing" })
    expect(await generateMetadata(props)).toEqual({ title: "Product not found" })
    await expect(ProductPage(props)).rejects.toThrow("NEXT_NOT_FOUND")
    expect(notFound).toHaveBeenCalledOnce()
  })

  it("renders the published product and its metadata when storage is ready", async () => {
    const product = normalizeCatalogProduct({
      id: "published-product",
      shop_id: 123,
      title: "Published tee",
      variants: [],
      options: [],
      images: [],
    })
    product.garment = {
      manufacturer: "Next Level",
      model: "6210",
      categorySlug: "t-shirts",
      categoryName: "T-shirts",
      categorySortPosition: 1,
      gender: "unisex",
    }
    vi.mocked(getCatalogProduct).mockResolvedValue({ status: "ready", product, isNew: false })
    expect(await generateMetadata(props)).toMatchObject({
      title: "Published tee",
      alternates: { canonical: "/shop/published-product" },
    })
    render(await ProductPage(props))
    expect(screen.getByText("Published product options")).toBeInTheDocument()
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
    expect(notFound).not.toHaveBeenCalled()
  })

  // ProductDetails renders the badge itself (product-details.test.tsx); the page only relays the
  // catalog's decision, which it must not recompute from the product's date while rendering.
  it.each([true, false])("passes the catalog's New decision (%s) through to the product details", async (isNew) => {
    const product = normalizeCatalogProduct({
      id: "published-product",
      shop_id: 123,
      title: "Published tee",
      storefront_added_to_shop_at: "2026-09-20T12:00:00.000Z",
      variants: [],
      options: [],
      images: [],
    })
    vi.mocked(getCatalogProduct).mockResolvedValue({ status: "ready", product, isNew })
    render(await ProductPage(props))
    expect(ProductDetails).toHaveBeenCalledExactlyOnceWith({ product, isNew }, undefined)
  })
})
