import { render, screen, within } from "@testing-library/react"
import { usePathname } from "next/navigation"
import { describe, expect, it, vi } from "vitest"
import { StoreHeader } from "./store-header"

vi.mock("next/navigation", () => ({ usePathname: vi.fn() }))
vi.mock("@/features/cart/use-cart", () => ({ useCart: () => ({ count: 2 }) }))
vi.mock("./brand-logo", () => ({ BrandLogo: () => <span>Fixture Store</span> }))

describe("store header admin navigation", () => {
  it.each(["/admin/setup", "/admin/sign-in"])("keeps %s focused on authentication", (pathname) => {
    vi.mocked(usePathname).mockReturnValue(pathname)
    render(<StoreHeader />)
    expect(screen.queryByRole("link", { name: "Account" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Designs" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Products" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Orders" })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Shop" })).toHaveAttribute("href", "/shop")
  })

  it("lists only studio pages once signed in, leaving the store to the logo", () => {
    vi.mocked(usePathname).mockReturnValue("/admin/products")
    render(<StoreHeader />)
    const navigation = within(screen.getByRole("navigation", { name: "Primary navigation" }))
    expect(navigation.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Designs",
      "Products",
      "Orders",
      "Account",
    ])
    expect(navigation.getByRole("link", { name: "Products" })).toHaveAttribute("href", "/admin/products")
    expect(navigation.getByRole("link", { name: "Products" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("link", { name: "Fixture Store home" })).toHaveAttribute("href", "/")
  })

  it("links to the implemented account page after sign-in", () => {
    vi.mocked(usePathname).mockReturnValue("/admin/account")
    render(<StoreHeader />)
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute("href", "/admin/account")
    expect(screen.getByRole("link", { name: "Designs" })).toHaveAttribute("href", "/admin/concepts")
  })

  it("marks the orders page in studio navigation", () => {
    vi.mocked(usePathname).mockReturnValue("/admin/orders")
    render(<StoreHeader />)
    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toHaveClass("font-condensed", "flex-wrap")
    expect(screen.getByRole("link", { name: "Orders" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("link", { name: "Orders" })).toHaveAttribute("href", "/admin/orders")
  })

  it("retains public shop and cart navigation", () => {
    vi.mocked(usePathname).mockReturnValue("/shop")
    render(<StoreHeader />)
    expect(screen.getByRole("link", { name: "Cart, 2 items" })).toHaveAttribute("href", "/cart")
    expect(screen.queryByRole("link", { name: "Account" })).not.toBeInTheDocument()
  })
})
