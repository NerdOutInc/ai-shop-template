import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ImageConfigContext } from "next/dist/shared/lib/image-config-context.shared-runtime"
import { imageConfigDefault } from "next/dist/shared/lib/image-config"
import { describe, expect, it } from "vitest"

import type { CatalogProduct } from "./catalog-product"
import { ProductCard } from "./product-card"

function catalogProductFixture(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    id: "sample-product",
    title: "Sample graphic shirt",
    description: "A shirt for everyday adventures and snack breaks.",
    addedToShopAt: "2026-09-01T12:00:00.000Z",
    salesCount: 2,
    image: null,
    images: [],
    price: { currency: "USD", min: 2500, max: 2500 },
    colors: [
      { name: "Black", hex: "#222222" },
      { name: "Heather Grey", hex: "#aaaaaa" },
    ],
    sizeGuide: null,
    options: [
      { name: "Colors", values: ["Black", "Heather Grey"] },
      { name: "Sizes", values: ["S", "M"] },
    ],
    variants: [
      {
        id: 1,
        title: "Black / S",
        color: "Black",
        size: "S",
        price: 2500,
        currency: "USD",
        available: true,
        options: [
          { name: "Colors", value: "Black" },
          { name: "Sizes", value: "S" },
        ],
      },
      {
        id: 2,
        title: "Heather Grey / M",
        color: "Heather Grey",
        size: "M",
        price: 2500,
        currency: "USD",
        available: true,
        options: [
          { name: "Colors", value: "Heather Grey" },
          { name: "Sizes", value: "M" },
        ],
      },
    ],
    availability: "available",
    ...overrides,
  }
}

const product = catalogProductFixture({ price: { currency: "USD", min: 2599, max: 2599 } })

describe("ProductCard", () => {
  it("serves responsive provider mockups and prioritizes only the requested card", () => {
    const src = "https://images-api.printify.com/mockup/product/variant/camera/shirt.jpg?camera_label=front"
    const props = { product: { ...product, image: { src, alt: "Optimized mockup" } } }
    const { rerender } = render(<ProductCard {...props} priority />, {
      wrapper: ({ children }) => (
        <ImageConfigContext.Provider
          value={{
            ...imageConfigDefault,
            remotePatterns: [
              { protocol: "https", hostname: "images-api.printify.com", port: "", pathname: "/mockup/**" },
            ],
          }}
        >
          {children}
        </ImageConfigContext.Provider>
      ),
    })
    const mockup = screen.getByRole("img", { name: "Optimized mockup" })
    const optimizedUrl = new URL(mockup.getAttribute("src") ?? "", "https://example.com")

    expect(optimizedUrl.pathname).toBe("/_next/image")
    expect(optimizedUrl.searchParams.get("url")).toBe(src)
    expect(mockup.getAttribute("srcset")).toContain("640w")
    expect(mockup.getAttribute("sizes")).toContain("calc(100vw - 32px)")
    expect(mockup).toHaveAttribute("loading", "eager")
    expect(mockup).toHaveAttribute("fetchpriority", "high")

    rerender(<ProductCard {...props} />)

    expect(mockup).toHaveAttribute("loading", "lazy")
    expect(mockup).not.toHaveAttribute("fetchpriority")
  })

  it("optimizes the approved artwork on its matched background alongside the original mockup", () => {
    render(
      <ProductCard
        product={{
          ...product,
          image: { src: "/shirt.jpg", alt: "Shirt mockup" },
          artwork: { src: "/artwork.webp", alt: "Shirt artwork", backgroundColor: "#126644" },
        }}
      />
    )
    expect(screen.getByRole("img", { name: "Shirt mockup" })).toHaveAttribute("src", "/shirt.jpg")
    const artwork = screen.getByRole("img", { name: "Shirt artwork" })
    const artworkUrl = new URL(artwork.getAttribute("src") ?? "", "http://localhost")
    expect(artworkUrl.pathname).toBe("/_next/image")
    expect(artworkUrl.searchParams.get("url")).toBe("/artwork.webp")
    expect(artwork.parentElement).toHaveStyle({ backgroundColor: "#126644" })
    expect(screen.getAllByRole("link")).toHaveLength(1)
  })

  it("keeps the shirt photo when its matching background color is unknown", () => {
    render(
      <ProductCard
        product={{
          ...product,
          image: { src: "/shirt.jpg", alt: "Shirt mockup" },
          artwork: { src: "/artwork.webp", alt: "Shirt artwork", backgroundColor: null },
        }}
      />
    )
    expect(screen.getByRole("img", { name: "Shirt mockup" })).toBeInTheDocument()
    expect(screen.queryByRole("img", { name: "Shirt artwork" })).not.toBeInTheDocument()
  })

  it("links to the product and labels exact garment colors alongside the saved USD retail price", () => {
    render(<ProductCard product={product} />)
    expect(screen.getByRole("article", { name: product.title })).toBeInTheDocument()
    expect(screen.getByText("$25.99")).toBeInTheDocument()
    expect(screen.getByText("USD")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Black" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Heather Grey" })).toBeInTheDocument()
    expect(screen.getByRole("link")).toHaveAttribute("href", `/shop/${product.id}`)
  })

  it("uses From only for a price range", () => {
    render(<ProductCard product={{ ...product, price: { currency: "USD", min: 2600, max: 3100 } }} />)

    expect(screen.getByText("From $26.00")).toBeInTheDocument()
    expect(screen.queryByText("$31.00")).not.toBeInTheDocument()
  })

  it("does not advertise a price when a selected product is unavailable", () => {
    render(<ProductCard product={{ ...product, availability: "unavailable", options: [] }} />)

    expect(screen.getByRole("heading", { name: product.title })).toBeInTheDocument()
    expect(screen.getByText("Currently unavailable")).toBeInTheDocument()
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
    expect(screen.queryByText("USD")).not.toBeInTheDocument()
  })

  it("shows the placeholder when there is no suitable image", () => {
    render(<ProductCard product={product} />)

    expect(screen.getByText("Product image coming soon")).toBeInTheDocument()
    expect(screen.queryByAltText(/shirt front/)).not.toBeInTheDocument()
  })

  it("preserves the mockup URL and descriptive alternative text", () => {
    render(
      <ProductCard
        product={{
          ...product,
          image: { src: "https://images.printify.com/mockup/sample.jpg", alt: "Sample shirt front mockup" },
        }}
      />
    )

    expect(screen.getByRole("img", { name: "Sample shirt front mockup" })).toHaveAttribute(
      "src",
      "https://images.printify.com/mockup/sample.jpg"
    )
  })

  it("starts with the primary color and selects matching photos and artwork backgrounds without navigating", async () => {
    const user = userEvent.setup()
    render(
      <ProductCard
        product={{
          ...product,
          defaultColor: "Heather Grey",
          image: { src: "/grey-primary.jpg", alt: "Grey primary mockup" },
          images: [
            { src: "/grey-primary.jpg", alt: "Grey primary mockup", variantIds: [2] },
            { src: "/black.jpg", alt: "Black mockup", variantIds: [1] },
          ],
          artwork: { src: "/artwork.webp", alt: "Shirt artwork", backgroundColor: "#aaaaaa" },
        }}
      />
    )

    expect(screen.getByRole("img", { name: "Grey primary mockup" })).toHaveAttribute("src", "/grey-primary.jpg")
    expect(screen.getByRole("button", { name: "Heather Grey" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Black" })).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByRole("link")).toHaveAttribute("href", `/shop/${product.id}?color=Heather+Grey`)

    await user.click(screen.getByRole("button", { name: "Black" }))

    expect(screen.getByRole("img", { name: "Black mockup" })).toHaveAttribute("src", "/black.jpg")
    expect(screen.queryByRole("img", { name: "Grey primary mockup" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Black" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Heather Grey" })).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByRole("img", { name: "Shirt artwork" }).parentElement).toHaveStyle({
      backgroundColor: "#222222",
    })
    expect(screen.getByRole("link")).not.toContainElement(screen.getByRole("button", { name: "Black" }))
    expect(screen.getByRole("link")).toHaveAttribute("href", `/shop/${product.id}?color=Black`)

    await user.click(screen.getByRole("button", { name: "Heather Grey" }))

    expect(screen.getByRole("img", { name: "Grey primary mockup" })).toHaveAttribute("src", "/grey-primary.jpg")
    expect(screen.getByRole("img", { name: "Shirt artwork" }).parentElement).toHaveStyle({
      backgroundColor: "#aaaaaa",
    })
    expect(screen.getByRole("link")).toHaveAttribute("href", `/shop/${product.id}?color=Heather+Grey`)
  })

  it("encodes product ids and exact color names without adding a size or extra query parameters", async () => {
    const user = userEvent.setup()
    const id = "shirt / #?"
    const defaultColor = "Cream + Sand / #1"
    const nextColor = "Teal & size=XL / Écru?"
    render(
      <ProductCard
        product={{
          ...product,
          id,
          defaultColor,
          colors: [
            { name: defaultColor, hex: "#ded1be" },
            { name: nextColor, hex: "#2a4f4f" },
          ],
          variants: product.variants.map((variant, index) => ({
            ...variant,
            color: index === 0 ? defaultColor : nextColor,
          })),
        }}
      />
    )

    const initialUrl = new URL(screen.getByRole("link").getAttribute("href")!, "https://example.com")
    expect(initialUrl.pathname).toBe(`/shop/${encodeURIComponent(id)}`)
    expect(initialUrl.searchParams.get("color")).toBe(defaultColor)
    expect([...initialUrl.searchParams.keys()]).toEqual(["color"])
    expect(initialUrl.hash).toBe("")

    await user.click(screen.getByRole("button", { name: nextColor }))

    const selectedUrl = new URL(screen.getByRole("link").getAttribute("href")!, "https://example.com")
    expect(selectedUrl.pathname).toBe(`/shop/${encodeURIComponent(id)}`)
    expect(selectedUrl.searchParams.get("color")).toBe(nextColor)
    expect([...selectedUrl.searchParams.keys()]).toEqual(["color"])
    expect(selectedUrl.hash).toBe("")
  })

  it("keeps the primary color first and preserves the other colors' order when choosing a different color", async () => {
    const user = userEvent.setup()
    render(
      <ProductCard
        product={{
          ...product,
          defaultColor: "Heather Grey",
          colors: [...product.colors, { name: "Navy", hex: "#283244" }],
          variants: [...product.variants, { ...product.variants[0]!, id: 3, color: "Navy" }],
        }}
      />
    )
    const colorOrder = () => screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"))

    expect(colorOrder()).toEqual(["Heather Grey", "Black", "Navy"])
    expect(screen.getByRole("link")).toHaveAttribute("href", `/shop/${product.id}?color=Heather+Grey`)

    await user.click(screen.getByRole("button", { name: "Navy" }))

    expect(colorOrder()).toEqual(["Heather Grey", "Black", "Navy"])
    expect(screen.getByRole("button", { name: "Navy" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("link")).toHaveAttribute("href", `/shop/${product.id}?color=Navy`)
  })

  it("does not mistake a shared photo for the selected color's mockup", async () => {
    const user = userEvent.setup()
    render(
      <ProductCard
        product={{
          ...product,
          defaultColor: "Black",
          image: { src: "/black.jpg", alt: "Black mockup" },
          images: [
            { src: "/black.jpg", alt: "Black mockup", variantIds: [1] },
            { src: "/shared.jpg", alt: "General shirt photo", variantIds: [1, 2] },
          ],
          artwork: { src: "/artwork.webp", alt: "Shirt artwork", backgroundColor: "#222222" },
        }}
      />
    )

    await user.click(screen.getByRole("button", { name: "Heather Grey" }))

    expect(screen.getByText("No photo for this color yet")).toBeInTheDocument()
    expect(screen.queryByRole("img")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Heather Grey" })).toHaveAttribute("aria-pressed", "true")
  })

  it("keeps a selected color's shirt photo when its artwork background is unknown", async () => {
    const user = userEvent.setup()
    render(
      <ProductCard
        product={{
          ...product,
          defaultColor: "Black",
          image: { src: "/black.jpg", alt: "Black mockup" },
          images: [{ src: "/grey.jpg", alt: "Grey mockup", variantIds: [2] }],
          colors: [product.colors[0]!, { name: "Heather Grey", hex: null }],
          artwork: { src: "/artwork.webp", alt: "Shirt artwork", backgroundColor: "#222222" },
        }}
      />
    )

    await user.click(screen.getByRole("button", { name: "Heather Grey" }))

    expect(screen.getByRole("img", { name: "Grey mockup" })).toHaveAttribute("src", "/grey.jpg")
    expect(screen.queryByRole("img", { name: "Shirt artwork" })).not.toBeInTheDocument()
  })

  it("only offers colors with an available variant", () => {
    render(
      <ProductCard
        product={{
          ...product,
          variants: product.variants.map((variant) => ({ ...variant, available: variant.color === "Black" })),
        }}
      />
    )

    expect(screen.getByRole("button", { name: "Black" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Heather Grey" })).not.toBeInTheDocument()
  })

  it("badges a new product over the product image, without touching the card's accessible name", () => {
    // The catalog decides what is new against one clock reading; the card never judges the date itself.
    const justAdded = { ...product, addedToShopAt: new Date().toISOString() }
    const { rerender } = render(<ProductCard product={justAdded} />)
    expect(screen.queryByText("New")).not.toBeInTheDocument()
    // The link is named by the card's h2 via aria-labelledby, so the badge must not enter that name.
    const nameBefore = screen.getByRole("link").getAttribute("aria-labelledby")

    rerender(<ProductCard product={product} isNew />)
    const badge = screen.getByText("New")
    expect(badge).toBeVisible()
    // Over the IMAGE, not the card: the media box is the only element whose box is the image.
    expect(badge.closest(".product-card-media")).not.toBeNull()
    // A touch on the badge must fall through to the link rather than read as an artwork preview.
    expect(badge).toHaveClass("pointer-events-none")
    // Not a heading, a link or a button, and not folded into the card's name.
    expect(badge.tagName).toBe("SPAN")
    expect(screen.getAllByRole("link")).toHaveLength(1)
    expect(screen.getByRole("link")).toHaveAttribute("aria-labelledby", nameBefore)
    expect(screen.getByRole("link")).toHaveAccessibleName("Sample graphic shirt")

    rerender(<ProductCard product={product} isNew={false} />)
    expect(screen.queryByText("New")).not.toBeInTheDocument()
  })
})
