import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ProductsSectionNav } from "./products-section-nav"

describe("ProductsSectionNav", () => {
  it("links the Products pages in a labelled landmark", () => {
    render(<ProductsSectionNav current="lineup" />)
    const nav = within(screen.getByRole("navigation", { name: "Products sections" }))
    expect(nav.getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Shop lineup", "/admin/products"],
      ["Categories", "/admin/products/categories"],
      ["Garment models", "/admin/products/garments"],
      ["Drop emails", "/admin/products/emails"],
    ])
  })

  // Colour alone marks the current button for sighted owners; a screen reader needs the attribute.
  it.each([
    ["lineup", "Shop lineup"],
    ["categories", "Categories"],
    ["garments", "Garment models"],
    ["emails", "Drop emails"],
  ] as const)("marks only the %s page as current", (current, label) => {
    render(<ProductsSectionNav current={current} />)
    const marked = screen.getAllByRole("link").filter((link) => link.hasAttribute("aria-current"))
    expect(marked).toHaveLength(1)
    expect(marked[0]).toHaveTextContent(label)
    expect(marked[0]).toHaveAttribute("aria-current", "page")
  })
})
