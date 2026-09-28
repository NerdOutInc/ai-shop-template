import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import AdminProductCategoriesPage from "./page"

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), listAdminGarmentSetup: vi.fn() }))
vi.mock("@/features/admin/require-admin.server", () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock("@/features/garment-catalog/list-admin-garment-setup.server", () => ({
  listAdminGarmentSetup: mocks.listAdminGarmentSetup,
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

beforeEach(() => {
  mocks.requireAdmin.mockResolvedValue({ userId: "owner" })
  mocks.listAdminGarmentSetup.mockResolvedValue({
    status: "ready",
    categories: [{ slug: "t-shirts", name: "T-shirts", garmentCount: 1 }],
    garments: [],
    productsWithoutBlueprint: 0,
  })
})

describe("admin categories page", () => {
  // There is no admin layout and the proxy only refreshes the session, so a page that reads before
  // it checks is a public page.
  it("reads nothing for a visitor the admin gate turns away", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("NEXT_REDIRECT"))
    await expect(AdminProductCategoriesPage()).rejects.toThrow("NEXT_REDIRECT")
    expect(mocks.listAdminGarmentSetup).not.toHaveBeenCalled()
  })

  it("shows the categories under the Products sections, with this one current", async () => {
    render(await AdminProductCategoriesPage())
    expect(screen.getByRole("heading", { level: 1, name: "Categories" })).toBeVisible()
    expect(screen.getByRole("link", { name: "Categories" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("list", { name: "Shop categories" })).toBeVisible()
  })

  // The manager keeps its own copy of the list, so "Reload categories" only takes effect because the
  // page keys it on what the server sent: a rename or a garment moved elsewhere starts it over.
  it.each([
    ["renamed", { slug: "t-shirts", name: "Tees", garmentCount: 1 }, "Tees", "Slug t-shirts · 1 garment"],
    ["emptied", { slug: "t-shirts", name: "T-shirts", garmentCount: 0 }, "T-shirts", "Slug t-shirts · no garments yet"],
  ])(
    "starts the manager over when a refresh brings a category %s elsewhere",
    async (_label, category, name, detail) => {
      const view = render(await AdminProductCategoriesPage())
      expect(screen.getByText("Slug t-shirts · 1 garment")).toBeVisible()
      expect(screen.getByRole("button", { name: "Delete T-shirts" })).toBeDisabled()
      mocks.listAdminGarmentSetup.mockResolvedValue({
        status: "ready",
        categories: [category],
        garments: [],
        productsWithoutBlueprint: 0,
      })
      view.rerender(await AdminProductCategoriesPage())
      expect(screen.getByRole("button", { name: `Rename ${name}` })).toBeVisible()
      expect(screen.getByText(detail)).toBeVisible()
    }
  )

  // Merging does not apply migrations here, so the page has to say so rather than 500.
  it("points at the migration when the garment tables cannot be read", async () => {
    mocks.listAdminGarmentSetup.mockResolvedValue({ status: "unavailable" })
    render(await AdminProductCategoriesPage())
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Categories are unavailable right now. Check that the latest migration has been pushed."
    )
    expect(screen.getByRole("navigation", { name: "Products sections" })).toBeVisible()
    expect(screen.queryByLabelText("New category name")).not.toBeInTheDocument()
  })
})
