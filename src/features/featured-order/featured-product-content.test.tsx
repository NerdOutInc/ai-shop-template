import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { FeaturedOrderProduct } from "./featured-order-product"
import { FeaturedProductContent } from "./featured-product-content"

const product: FeaturedOrderProduct = {
  id: "sample-tee",
  title: "Sample tee",
  image: { src: "/mockup.png", alt: "Sample tee" },
  hiddenAt: null,
  revealAt: null,
  revealedAt: null,
  addedToShopAt: null,
}

describe("FeaturedProductContent", () => {
  it("multiplies provider mockups onto the tile but leaves store photographs unblended", () => {
    const { container, rerender } = render(<FeaturedProductContent product={product} interactive={false} />)
    expect(container.querySelector("img")).toHaveClass("mix-blend-multiply")
    rerender(
      <FeaturedProductContent
        product={{ ...product, image: { src: "/photo.jpg", alt: "Sample tee", origin: "store" } }}
        interactive={false}
      />
    )
    expect(container.querySelector("img")).not.toHaveClass("mix-blend-multiply")
    expect(screen.getByText("Sample tee")).toBeInTheDocument()
  })
})
