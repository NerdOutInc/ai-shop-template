import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import AdminGarmentModelsPage from "./page"

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), listAdminGarmentSetup: vi.fn() }))
vi.mock("@/features/admin/require-admin.server", () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock("@/features/garment-catalog/list-admin-garment-setup.server", () => ({
  listAdminGarmentSetup: mocks.listAdminGarmentSetup,
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const found = {
  blueprintId: 9999,
  known: false,
  complete: false,
  manufacturer: null,
  model: null,
  categorySlug: null,
  googleProductCategory: null,
  gender: null,
  ageGroup: null,
  sizeSystem: null,
  productCount: 1,
  shownCount: 0,
  scheduledCount: 0,
}

beforeEach(() => {
  mocks.requireAdmin.mockResolvedValue({ userId: "owner" })
  mocks.listAdminGarmentSetup.mockResolvedValue({
    status: "ready",
    categories: [{ slug: "t-shirts", name: "T-shirts", garmentCount: 0 }],
    garments: [found],
    productsWithoutBlueprint: 0,
  })
})

describe("admin garment models page", () => {
  it("reads nothing for a visitor the admin gate turns away", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("NEXT_REDIRECT"))
    await expect(AdminGarmentModelsPage()).rejects.toThrow("NEXT_REDIRECT")
    expect(mocks.listAdminGarmentSetup).not.toHaveBeenCalled()
  })

  it("lists the garments with a card a product row can link to, and offers to add another", async () => {
    render(await AdminGarmentModelsPage())
    expect(screen.getByRole("heading", { level: 1, name: "Garment models" })).toBeVisible()
    expect(screen.getByRole("link", { name: "Garment models" })).toHaveAttribute("aria-current", "page")
    expect(document.getElementById("garment-9999")).toBeVisible()
    expect(screen.getByLabelText("Printify catalog link or blueprint number")).toBeVisible()
  })

  it("points at the migration when the garment tables cannot be read", async () => {
    mocks.listAdminGarmentSetup.mockResolvedValue({ status: "unavailable" })
    render(await AdminGarmentModelsPage())
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Garment models are unavailable right now. Check that the latest migration has been pushed."
    )
    expect(screen.queryByLabelText("Printify catalog link or blueprint number")).not.toBeInTheDocument()
  })
})
