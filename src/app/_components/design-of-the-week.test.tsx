import { render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { getCatalog } from "@/features/catalog/get-catalog.server"
import { normalizeCatalogProduct } from "@/features/catalog/normalize-catalog-product"
import { readProductWeek } from "@/features/design-of-the-week/read-product-week.server"

import { DesignOfTheWeek } from "./design-of-the-week"

vi.mock("server-only", () => ({}))
const store = vi.hoisted(() => ({ configured: true, name: "Fixture Store", policies: { published: true } }))
vi.mock("@/lib/store-config", () => ({ storeConfig: store }))
vi.mock("next/server", () => ({ connection: vi.fn() }))
vi.mock("@/features/catalog/get-catalog.server", () => ({ getCatalog: vi.fn() }))
vi.mock("@/features/design-of-the-week/read-product-week.server", () => ({ readProductWeek: vi.fn() }))
vi.mock("@/features/drop-signup/drop-signup-form", () => ({ DropSignupForm: () => <div>Drop signup</div> }))

const products = Array.from({ length: 7 }, (_, index) => ({
  ...normalizeCatalogProduct({
    id: `product-${index}`,
    shop_id: 123,
    title: `Graphic tee ${index}`,
    variants: [],
    options: [],
    images: [],
  }),
  availability: "available" as const,
}))
const week = { liveAt: "2026-09-21T09:00:00.000Z", productIds: ["product-0", "product-2", "missing"] }

beforeEach(() => {
  vi.clearAllMocks()
  store.configured = true
  store.policies.published = true
  vi.mocked(readProductWeek).mockResolvedValue(week)
  vi.mocked(getCatalog).mockResolvedValue({
    status: "ready",
    products,
    designOfTheWeekProductIds: ["product-0", "product-2"],
    newProductIds: [],
  })
})

describe("product-based weekly feature", () => {
  it("shares a single weekly read and renders only explicit catalog members as product cards", async () => {
    render(await DesignOfTheWeek())
    expect(readProductWeek).toHaveBeenCalledOnce()
    expect(getCatalog).toHaveBeenCalledWith({ productWeek: expect.any(Promise) })
    await expect(vi.mocked(getCatalog).mock.calls[0]![0]!.productWeek).resolves.toEqual(week)
    expect(screen.getByRole("heading", { level: 2, name: "This week’s picks." })).toHaveTextContent(
      "This week’s picks."
    )
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1)
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
      "This week’s products",
      "More like this",
      "Get told about the next drop",
    ])
    const featured = within(screen.getByRole("list", { name: "Design of the Week products" }))
    expect(featured.getAllByRole("article")).toHaveLength(2)
    expect(featured.getAllByRole("heading", { level: 4 })).toHaveLength(2)
    expect(featured.getByRole("article", { name: "Graphic tee 0" })).toBeInTheDocument()
    expect(featured.getByRole("article", { name: "Graphic tee 2" })).toBeInTheDocument()
    expect(featured.queryByRole("article", { name: "Graphic tee 1" })).not.toBeInTheDocument()
    expect(featured.getByRole("link", { name: "Graphic tee 2" })).toHaveAttribute("href", "/shop/product-2")
    const more = within(screen.getByRole("list", { name: "More like this" }))
    expect(more.getAllByRole("article")).toHaveLength(4)
    expect(more.getAllByRole("heading", { level: 4 })).toHaveLength(4)
    expect(more.queryByRole("article", { name: "Graphic tee 0" })).not.toBeInTheDocument()
    expect(more.queryByRole("article", { name: "Graphic tee 2" })).not.toBeInTheDocument()
    expect(screen.getByText("Drop signup")).toBeInTheDocument()
  })

  it("badges the catalog's new products in both grids, and never a drop tee just for being in the drop", async () => {
    // Being picked for this week does not make a tee new: product-0 is a returning favorite.
    vi.mocked(getCatalog).mockResolvedValue({
      status: "ready",
      products,
      designOfTheWeekProductIds: ["product-0", "product-2"],
      newProductIds: ["product-2", "product-4"],
    })
    render(await DesignOfTheWeek())
    const badgedTitles = (name: string) =>
      within(screen.getByRole("list", { name }))
        .getAllByRole("article")
        .filter((card) => within(card).queryByText("New"))
        .map((card) => within(card).getByRole("heading").textContent)

    expect(badgedTitles("Design of the Week products")).toEqual(["Graphic tee 2"])
    // This week's seed picks product-1, 3, 4 and 5 for More like this.
    expect(within(screen.getByRole("list", { name: "More like this" })).getAllByRole("article")).toHaveLength(4)
    expect(badgedTitles("More like this")).toEqual(["Graphic tee 4"])
  })

  it.each([null, week])("keeps signup and shop navigation when no selected product is public", async (current) => {
    vi.mocked(readProductWeek).mockResolvedValue(current)
    vi.mocked(getCatalog).mockResolvedValue({ status: "ready", products, designOfTheWeekProductIds: [] })
    render(await DesignOfTheWeek())
    expect(screen.getByRole("heading", { level: 2, name: "New designs are on their way." })).toHaveTextContent(
      "New designs are on their way."
    )
    expect(screen.queryByRole("list", { name: "Design of the Week products" })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Shop all tees" })).toHaveAttribute("href", "/shop")
    expect(screen.getByText("Drop signup")).toBeInTheDocument()
  })
})

it("does not collect emails before store setup and policy approval", async () => {
  store.configured = false
  render(await DesignOfTheWeek())
  expect(screen.queryByText("Drop signup")).not.toBeInTheDocument()
})
