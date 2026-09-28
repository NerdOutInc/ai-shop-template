import { render, screen, within } from "@testing-library/react"
import { usePathname, useSelectedLayoutSegment } from "next/navigation"
import { storeConfig } from "@/lib/store-config"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { StoreHeader } from "./store-header"

vi.mock("next/navigation", () => ({ usePathname: vi.fn(), useSelectedLayoutSegment: vi.fn() }))
beforeEach(() => vi.mocked(useSelectedLayoutSegment).mockReturnValue("admin"))
vi.mock("@/features/cart/use-cart", () => ({ useCart: () => ({ count: 2 }) }))
vi.mock("./brand-logo", () => ({ BrandLogo: () => <span>Fixture Store</span> }))

describe("store header admin navigation", () => {
  it.each(["/admin/setup", "/admin/sign-in"])("keeps %s focused on authentication", (pathname) => {
    vi.mocked(usePathname).mockReturnValue(pathname)
    render(<StoreHeader adminEnabled />)
    expect(screen.queryByRole("link", { name: "Account" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Designs" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Products" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Orders" })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Shop" })).toHaveAttribute("href", "/shop")
  })

  it("lists only studio pages once signed in, leaving the store to the logo", () => {
    vi.mocked(usePathname).mockReturnValue("/admin/products")
    render(<StoreHeader adminEnabled />)
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
    render(<StoreHeader adminEnabled />)
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute("href", "/admin/account")
    expect(screen.getByRole("link", { name: "Designs" })).toHaveAttribute("href", "/admin/concepts")
  })

  it("marks the orders page in studio navigation", () => {
    vi.mocked(usePathname).mockReturnValue("/admin/orders")
    render(<StoreHeader adminEnabled />)
    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toHaveClass("font-condensed", "flex-wrap")
    expect(screen.getByRole("link", { name: "Orders" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("link", { name: "Orders" })).toHaveAttribute("href", "/admin/orders")
  })

  it("retains public shop and cart navigation", () => {
    vi.mocked(usePathname).mockReturnValue("/shop")
    vi.mocked(useSelectedLayoutSegment).mockReturnValue("shop")
    render(<StoreHeader adminEnabled />)
    expect(screen.getByRole("link", { name: "Cart, 2 items" })).toHaveAttribute("href", "/cart")
    expect(screen.queryByRole("link", { name: "Account" })).not.toBeInTheDocument()
  })
})

it.each([false, true])("shows About in public navigation only when enabled (%s)", (enabled) => {
  storeConfig.features.about = enabled
  vi.mocked(usePathname).mockReturnValue("/about")
  vi.mocked(useSelectedLayoutSegment).mockReturnValue("about")
  render(<StoreHeader adminEnabled />)
  const about = screen.queryByRole("link", { name: "About" })
  if (enabled) expect(about).toHaveAttribute("aria-current", "page")
  else expect(about).not.toBeInTheDocument()
  expect(screen.getByRole("link", { name: "Shop" })).toBeVisible()
})

it("keeps an unmatched admin-looking URL on storefront navigation", () => {
  vi.mocked(usePathname).mockReturnValue("/admin/not-a-route")
  vi.mocked(useSelectedLayoutSegment).mockReturnValue(null)
  render(<StoreHeader adminEnabled />)
  expect(screen.getByRole("link", { name: "Shop" })).toBeVisible()
  expect(screen.queryByRole("link", { name: "Designs" })).not.toBeInTheDocument()
})

it("does not expose studio navigation while admin is disabled", () => {
  vi.mocked(usePathname).mockReturnValue("/admin/products")
  render(<StoreHeader adminEnabled={false} />)
  expect(screen.getByRole("link", { name: "Shop" })).toBeVisible()
  expect(screen.queryByRole("link", { name: "Designs" })).not.toBeInTheDocument()
})
