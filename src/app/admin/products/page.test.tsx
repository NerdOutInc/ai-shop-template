import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { FeaturedOrderProduct } from "@/features/featured-order/featured-order-product"

import AdminProductsPage from "./page"

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  listFeaturedOrder: vi.fn(),
  readAdminProductSchedule: vi.fn(),
  listProductGarmentStatus: vi.fn(),
}))
vi.mock("@/features/admin/require-admin.server", () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock("@/features/featured-order/list-featured-order.server", () => ({
  listFeaturedOrder: mocks.listFeaturedOrder,
}))
vi.mock("@/features/design-of-the-week/read-admin-product-schedule.server", () => ({
  readAdminProductSchedule: mocks.readAdminProductSchedule,
}))
vi.mock("@/features/garment-catalog/list-product-garment-status.server", () => ({
  listProductGarmentStatus: mocks.listProductGarmentStatus,
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const now = Date.parse("2026-09-20T12:00:00.000Z")
// In the shop since Sep 1, so nothing starts out wearing the New badge.
const shown = {
  hiddenAt: null,
  revealAt: null,
  revealedAt: "2026-09-01T00:00:00.000Z",
  addedToShopAt: "2026-09-01T00:00:00.000Z",
}
const hidden = { hiddenAt: "2026-09-19T10:00:00.000Z", revealAt: null, revealedAt: null, addedToShopAt: null }
const products: FeaturedOrderProduct[] = [
  { id: "everyday-type", title: "Everyday Type", image: null, ...shown },
  { id: "crop", title: "Crop Life", image: null, ...hidden },
  { id: "tank", title: "Tank Day", image: null, ...hidden },
]

beforeEach(() => {
  mocks.requireAdmin.mockResolvedValue({ userId: "owner" })
  mocks.listFeaturedOrder.mockResolvedValue({ status: "ready", products, now })
  mocks.readAdminProductSchedule.mockResolvedValue({ status: "ready", entries: [], now })
  mocks.listProductGarmentStatus.mockResolvedValue([
    { productId: "everyday-type", blueprintId: 1317, complete: true, label: "Next Level 6210" },
    { productId: "crop", blueprintId: 1312, complete: false, label: "Next Level 5080" },
    { productId: "tank", blueprintId: null, complete: false, label: null },
  ])
})

async function expectMenuAction(product: string, action: string, disabled: boolean) {
  const user = userEvent.setup()
  await user.click(screen.getByRole("button", { name: `Actions for ${product}` }))
  const item = await screen.findByRole("menuitem", { name: action })
  if (disabled) expect(item).toHaveAttribute("aria-disabled", "true")
  else expect(item).not.toHaveAttribute("aria-disabled", "true")
  await user.keyboard("{Escape}")
}

describe("admin products page", () => {
  it("reads nothing for a visitor the admin gate turns away", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("NEXT_REDIRECT"))
    await expect(AdminProductsPage()).rejects.toThrow("NEXT_REDIRECT")
    expect(mocks.listFeaturedOrder).not.toHaveBeenCalled()
    expect(mocks.listProductGarmentStatus).not.toHaveBeenCalled()
  })

  it("marks the rows waiting on a garment, disables their Show, and sums them up above the lists", async () => {
    render(await AdminProductsPage())
    expect(screen.getByRole("link", { name: "Shop lineup" })).toHaveAttribute("aria-current", "page")
    const summary = screen.getByText(/^2 products are waiting on garment setup and cannot be shown or scheduled\./)
    expect(within(summary).getByRole("link", { name: "Open Garment models" })).toHaveAttribute(
      "href",
      "/admin/products/garments"
    )
    expect(screen.getByRole("link", { name: "Set up Next Level 5080 for Crop Life" })).toHaveAttribute(
      "href",
      "/admin/products/garments#garment-1312"
    )
    expect(screen.getByRole("link", { name: "Open Garment models for Tank Day" })).toBeVisible()
    await expectMenuAction("Crop Life", "Show in shop", true)
    await expectMenuAction("Tank Day", "Show in shop", true)
    // A complete garment leaves its product exactly as it was.
    expect(screen.queryByRole("link", { name: /for Everyday Type$/ })).not.toBeInTheDocument()
  })

  it("counts a single waiting product in the singular", async () => {
    mocks.listProductGarmentStatus.mockResolvedValue([
      { productId: "crop", blueprintId: 1312, complete: false, label: null },
    ])
    render(await AdminProductsPage())
    expect(screen.getByText(/^1 product is waiting on garment setup and cannot be shown or scheduled\./)).toBeVisible()
    await expectMenuAction("Tank Day", "Show in shop", false)
  })

  // A shown tee can sit on an unfinished garment (a republish onto another blueprint, a new store's
  // bootstrap). It stays up and sells, so "cannot be shown" would be false about it: its row keeps
  // the pointer, and the summary counts only the tees that really are held back.
  it("leaves a product that is already in the shop out of the cannot-be-shown count", async () => {
    mocks.listProductGarmentStatus.mockResolvedValue([
      { productId: "everyday-type", blueprintId: 1317, complete: false, label: "Next Level 6210" },
      { productId: "crop", blueprintId: 1312, complete: false, label: "Next Level 5080" },
    ])
    render(await AdminProductsPage())
    expect(screen.getByText(/^1 product is waiting on garment setup and cannot be shown or scheduled\./)).toBeVisible()
    expect(screen.getByRole("link", { name: "Set up Next Level 6210 for Everyday Type" })).toBeVisible()
    await expectMenuAction("Everyday Type", "Hide from shop", false)
  })

  it("says nothing above the lists when the only unfinished garment is under a shown product", async () => {
    mocks.listProductGarmentStatus.mockResolvedValue([
      { productId: "everyday-type", blueprintId: 1317, complete: false, label: "Next Level 6210" },
    ])
    render(await AdminProductsPage())
    expect(screen.queryByText(/waiting on garment setup/)).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Set up Next Level 6210 for Everyday Type" })).toBeVisible()
  })

  // A hide whose reveal moment has passed is on the wall, whatever hiddenAt still says.
  it("counts a scheduled product until its reveal arrives, and not after", async () => {
    const scheduled = (revealAt: string) => [{ id: "crop", title: "Crop Life", image: null, ...hidden, revealAt }]
    mocks.listProductGarmentStatus.mockResolvedValue([
      { productId: "crop", blueprintId: 1312, complete: false, label: null },
    ])
    mocks.listFeaturedOrder.mockResolvedValue({
      status: "ready",
      products: scheduled("2026-09-21T12:00:00.000Z"),
      now,
    })
    const view = render(await AdminProductsPage())
    expect(screen.getByText(/^1 product is waiting on garment setup/)).toBeVisible()
    view.unmount()
    mocks.listFeaturedOrder.mockResolvedValue({
      status: "ready",
      products: scheduled("2026-09-20T11:00:00.000Z"),
      now,
    })
    render(await AdminProductsPage())
    expect(screen.queryByText(/waiting on garment setup/)).not.toBeInTheDocument()
  })

  // The list copies its products once, so without the garment flag in its key a router.refresh()
  // after the garment is finished would leave Show disabled until a hard reload.
  it("re-enables Show when a refresh reports the garment finished", async () => {
    const view = render(await AdminProductsPage())
    await expectMenuAction("Crop Life", "Show in shop", true)
    mocks.listProductGarmentStatus.mockResolvedValue([
      { productId: "everyday-type", blueprintId: 1317, complete: true, label: "Next Level 6210" },
      { productId: "crop", blueprintId: 1312, complete: true, label: "Next Level 5080" },
      { productId: "tank", blueprintId: null, complete: false, label: null },
    ])
    view.rerender(await AdminProductsPage())
    await expectMenuAction("Crop Life", "Show in shop", false)
    expect(screen.queryByRole("link", { name: /for Crop Life$/ })).not.toBeInTheDocument()
    expect(screen.getByText(/^1 product is waiting on garment setup/)).toBeVisible()
    await expectMenuAction("Tank Day", "Show in shop", true)
  })

  // Hidden and shown again in another tab: hiddenAt and revealAt read exactly as before and only the
  // arrival moved, so a key without it would keep the list's stale copy and leave the tee unbadged.
  it("badges a tee when a refresh reports that it re-entered the shop", async () => {
    const view = render(await AdminProductsPage())
    expect(screen.queryByText("New")).not.toBeInTheDocument()
    mocks.listFeaturedOrder.mockResolvedValue({
      status: "ready",
      products: [{ ...products[0]!, addedToShopAt: "2026-09-20T11:00:00.000Z" }, ...products.slice(1)],
      now,
    })
    view.rerender(await AdminProductsPage())
    expect(within(screen.getByRole("list", { name: "Available products" })).getByText("New")).toBeVisible()
  })

  // Null is "could not tell" (the migration may be merged but not pushed), never "all fine" and
  // never "all broken": the lineup carries on with no notices, and the server still refuses.
  it("carries on without garment notices when the garment read could not tell", async () => {
    mocks.listProductGarmentStatus.mockResolvedValue(null)
    render(await AdminProductsPage())
    expect(screen.getByRole("list", { name: "Hidden products" })).toBeVisible()
    expect(screen.queryByText(/waiting on garment setup/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Garment setup missing/)).not.toBeInTheDocument()
    await expectMenuAction("Crop Life", "Show in shop", false)
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("says nothing when every garment is complete", async () => {
    mocks.listProductGarmentStatus.mockResolvedValue(
      products.map((product) => ({
        productId: product.id,
        blueprintId: 1317,
        complete: true,
        label: "Next Level 6210",
      }))
    )
    render(await AdminProductsPage())
    expect(screen.queryByText(/waiting on garment setup/)).not.toBeInTheDocument()
    await expectMenuAction("Crop Life", "Show in shop", false)
  })

  it("keeps the section links when the lineup itself is unavailable", async () => {
    mocks.listFeaturedOrder.mockResolvedValue({ status: "unavailable" })
    render(await AdminProductsPage())
    expect(screen.getByRole("alert")).toHaveTextContent("The product list is unavailable right now.")
    expect(screen.getByRole("navigation", { name: "Products sections" })).toBeVisible()
    expect(screen.queryByText(/waiting on garment setup/)).not.toBeInTheDocument()
  })
  it("renders six successive weeks, including populated dates, with hidden admin preview links", async () => {
    mocks.readAdminProductSchedule.mockResolvedValue({
      status: "ready",
      now,
      entries: [{ id: "queued-crop", productId: "crop", liveAt: "2026-09-21T09:00:00.000Z" }],
    })
    render(await AdminProductsPage())
    expect(screen.getAllByRole("region", { name: /^Week of / })).toHaveLength(6)
    expect(screen.getByRole("region", { name: /Week of Monday, September 21/ })).toHaveTextContent("Crop Life")
    const hiddenList = within(screen.getByRole("list", { name: "Hidden products" }))
    expect(hiddenList.getByRole("link", { name: /Preview product.*Crop Life/ })).toHaveAttribute(
      "href",
      "/admin/products/crop"
    )
  })

  it("keeps the lineup available and explains migration needs when the schedule storage is unavailable", async () => {
    mocks.readAdminProductSchedule.mockResolvedValue({ status: "unavailable" })
    render(await AdminProductsPage())
    expect(screen.getByRole("alert")).toHaveTextContent("weekly schedule is unavailable")
    expect(screen.getByRole("list", { name: "Available products" })).toBeVisible()
    expect(screen.queryByRole("region", { name: /^Week of / })).not.toBeInTheDocument()
  })

  it("shows all six empty weeks before the first product is published", async () => {
    mocks.listFeaturedOrder.mockResolvedValue({ status: "ready", products: [], now })
    render(await AdminProductsPage())
    expect(screen.getAllByRole("region", { name: /^Week of / })).toHaveLength(6)
    expect(screen.getByText("No published products yet")).toBeVisible()
  })
})
