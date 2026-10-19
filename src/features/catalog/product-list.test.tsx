import "../../../test/configured-store"
import { render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import userEvent from "@testing-library/user-event"

import { storeConfig } from "@/lib/store-config"

import type { CatalogProduct } from "./catalog-product"

import { ProductList } from "./product-list"

vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react")
  return {
    useSearchParams: () =>
      new URLSearchParams(
        useSyncExternalStore(
          (notify) => {
            window.addEventListener("popstate", notify)
            return () => window.removeEventListener("popstate", notify)
          },
          () => window.location.search
        )
      ),
  }
})

beforeEach(() => {
  window.history.replaceState(null, "", "/shop")
  const replaceState = window.history.replaceState.bind(window.history)
  // Model Next's search-parameter notification around jsdom's real URL/history implementation.
  vi.spyOn(window.history, "replaceState").mockImplementation((...args) => {
    replaceState(...args)
    window.dispatchEvent(new PopStateEvent("popstate"))
  })
})

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

const product = catalogProductFixture()
const categoryProducts = [
  catalogProductFixture({
    id: "crop",
    title: "Festival crop top",
    addedToShopAt: "2026-09-10T12:00:00.000Z",
    garment: {
      manufacturer: "Next Level",
      model: "5080",
      categoryName: "Crop tops",
      categorySlug: "crop-tops",
      categorySortPosition: 3,
      gender: "female",
    },
    variants: [product.variants[1]!],
  }),
  catalogProductFixture({
    id: "tee",
    title: "Graphic T-shirt",
    garment: {
      manufacturer: "Next Level",
      model: "6210",
      categoryName: "T-shirts",
      categorySlug: "t-shirts",
      categorySortPosition: 1,
      gender: "unisex",
    },
    variants: [product.variants[0]!],
  }),
  catalogProductFixture({ id: "unassigned", title: "Unassigned garment", addedToShopAt: "2026-09-20T12:00:00.000Z" }),
]

describe("ProductList", () => {
  it("groups blue shades while requiring the requested size on an available blue variant", async () => {
    const user = userEvent.setup()
    const shades = [
      "Heather Cool Blue",
      "CVC Midnight Navy",
      "CVC Ice Blue",
      "CVC Royal",
      "CVC Red",
      "CVC Mint",
      "CVC Clay",
      "Antique Denim",
      "Chambray",
      "CVC Turquoise",
      "CVC Silk",
    ]
    const products = shades.map((name, index) =>
      catalogProductFixture({
        id: `shade-${index}`,
        title: `Shirt ${index}`,
        colors: [{ name, hex: name === "CVC Clay" ? "#b37a58" : null }],
        variants: [{ ...product.variants[0]!, color: name, size: index === 2 ? "M" : "S", available: index !== 5 }],
      })
    )
    render(<ProductList catalog={{ status: "ready", products }} />)
    await user.click(screen.getByRole("button", { name: "Filters +" }))
    expect(screen.getAllByRole("checkbox", { name: "Blue" })).toHaveLength(1)
    expect(screen.queryByRole("checkbox", { name: "Green" })).not.toBeInTheDocument()
    expect(screen.queryByRole("checkbox", { name: "CVC Midnight Navy" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("checkbox", { name: "Blue" }))
    expect(screen.getAllByRole("article")).toHaveLength(7)
    await user.click(screen.getByRole("checkbox", { name: "M" }))
    expect(screen.getByRole("article")).toHaveAccessibleName("Shirt 2")
    await user.click(screen.getByRole("button", { name: "Clear all" }))
    expect(screen.getAllByRole("article")).toHaveLength(11)
    await user.click(screen.getByRole("checkbox", { name: "Clay" }))
    expect(screen.getByRole("article")).toHaveAccessibleName("Shirt 6")
    await user.click(screen.getByRole("button", { name: "Clear all" }))
    await user.click(screen.getByRole("checkbox", { name: "Gray" }))
    expect(screen.getByRole("article")).toHaveAccessibleName("Shirt 10")
  })

  it("follows the owner's category order, with slug order breaking ties", () => {
    const tee = categoryProducts[1]!
    const crop = categoryProducts[0]!
    const sweatshirt = catalogProductFixture({
      id: "sweatshirt",
      garment: {
        ...tee.garment!,
        categoryName: "Sweatshirts",
        categorySlug: "sweatshirts",
        categorySortPosition: 2,
      },
    })
    const { rerender } = render(<ProductList catalog={{ status: "ready", products: [crop, sweatshirt, tee] }} />)
    const categoryNames = () =>
      within(screen.getByRole("group", { name: "Category" }))
        .getAllByRole("button")
        .map((button) => button.textContent)
    expect(categoryNames()).toEqual(["T-shirts", "Sweatshirts", "Crop tops"])

    rerender(
      <ProductList
        catalog={{
          status: "ready",
          products: [
            { ...tee, garment: { ...tee.garment!, categorySortPosition: 2 } },
            sweatshirt,
            { ...crop, garment: { ...crop.garment!, categoryName: "Festival crops", categorySortPosition: 0 } },
          ],
        }}
      />
    )
    expect(categoryNames()).toEqual(["Festival crops", "Sweatshirts", "T-shirts"])
  })

  it.each([{ categorized: [] }, { categorized: [categoryProducts[1]!] }])(
    "hides the category row without multiple choices: $categorized.length",
    ({ categorized }) => {
      render(<ProductList catalog={{ status: "ready", products: [...categorized, product] }} />)
      expect(screen.queryByRole("group", { name: "Category" })).not.toBeInTheDocument()
      expect(screen.getAllByRole("article")).toHaveLength(categorized.length + 1)
    }
  )

  it("can clear a linked category when the catalog now has only one category", async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, "", "/shop?category=t-shirts")
    render(<ProductList catalog={{ status: "ready", products: [categoryProducts[1]!, product] }} />)
    expect(screen.queryByRole("group", { name: "Category" })).not.toBeInTheDocument()
    expect(screen.getAllByRole("article")).toHaveLength(1)
    await user.click(screen.getByRole("button", { name: "Filters +" }))
    await user.click(screen.getByRole("button", { name: "Clear all" }))
    expect(screen.getAllByRole("article")).toHaveLength(2)
    expect(window.location.search).toBe("")
  })

  it("starts with all categories off and includes either selected category without dropping unassigned products by default", async () => {
    const user = userEvent.setup()
    render(<ProductList catalog={{ status: "ready", products: categoryProducts }} />)
    const tee = screen.getByRole("button", { name: "T-shirts" })
    const crop = screen.getByRole("button", { name: "Crop tops" })
    const titles = () => screen.getAllByRole("article").map((card) => within(card).getByRole("heading").textContent)
    const categoryButtons = screen.getAllByRole("button", { name: /^(T-shirts|Crop tops)$/ })

    expect(categoryButtons).toEqual([tee, crop])
    expect(tee).toHaveAttribute("aria-pressed", "false")
    expect(crop).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByText("3 good things to wear")).toBeInTheDocument()
    expect(titles()).toEqual(["Festival crop top", "Graphic T-shirt", "Unassigned garment"])

    await user.click(tee)
    expect(tee).toHaveAttribute("aria-pressed", "true")
    expect(crop).toHaveAttribute("aria-pressed", "false")
    expect(titles()).toEqual(["Graphic T-shirt"])
    expect(screen.getByText("1 good thing to wear")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Filters +" })).toBeInTheDocument()

    await user.click(crop)
    expect(tee).toHaveAttribute("aria-pressed", "true")
    expect(crop).toHaveAttribute("aria-pressed", "true")
    expect(titles()).toEqual(["Festival crop top", "Graphic T-shirt"])
    expect(screen.getByText("2 good things to wear")).toBeInTheDocument()

    await user.click(tee)
    expect(titles()).toEqual(["Festival crop top"])
    await user.click(crop)
    expect(titles()).toEqual(["Festival crop top", "Graphic T-shirt", "Unassigned garment"])
    expect(screen.getByRole("button", { name: "Filters +" })).toBeInTheDocument()
  })

  it("combines category, size, and color and clears all three without changing the selected sort", async () => {
    const user = userEvent.setup()
    render(<ProductList catalog={{ status: "ready", products: categoryProducts }} />)
    const sort = screen.getByRole("combobox", { name: "Sort by" })
    await user.selectOptions(sort, "newest")
    await user.click(screen.getByRole("button", { name: "T-shirts" }))
    await user.click(screen.getByRole("button", { name: "Filters +" }))
    await user.click(screen.getByRole("checkbox", { name: "S" }))
    await user.click(screen.getByRole("checkbox", { name: "Black" }))
    expect(screen.getAllByRole("article")).toHaveLength(1)
    expect(screen.getByRole("article")).toHaveAccessibleName("Graphic T-shirt")
    expect(screen.getByRole("button", { name: "Filters (2) −" })).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Clear all" }))

    expect(screen.getByRole("button", { name: "T-shirts" })).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByRole("checkbox", { name: "S" })).not.toBeChecked()
    expect(screen.getByRole("checkbox", { name: "Black" })).not.toBeChecked()
    expect(screen.getByRole("button", { name: "Filters −" })).toBeInTheDocument()
    expect(sort).toHaveValue("newest")
    expect(screen.getAllByRole("article").map((card) => within(card).getByRole("heading").textContent)).toEqual([
      "Unassigned garment",
      "Festival crop top",
      "Graphic T-shirt",
    ])
    expect(screen.queryByRole("button", { name: "Clear all" })).not.toBeInTheDocument()
  })

  it("clears category selections from the empty-result reset as well as size and color", async () => {
    const user = userEvent.setup()
    render(<ProductList catalog={{ status: "ready", products: categoryProducts }} initialSort="newest" />)
    const crop = screen.getByRole("button", { name: "Crop tops" })
    await user.click(crop)
    await user.click(screen.getByRole("button", { name: "Filters +" }))
    await user.click(screen.getByRole("checkbox", { name: "M" }))
    await user.click(screen.getByRole("checkbox", { name: "Black" }))
    expect(screen.getByText("0 good things to wear")).toBeInTheDocument()
    expect(screen.queryByRole("list", { name: "Products" })).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Clear filters" }))

    expect(crop).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByRole("checkbox", { name: "M" })).not.toBeChecked()
    expect(screen.getByRole("checkbox", { name: "Black" })).not.toBeChecked()
    expect(screen.getAllByRole("article")).toHaveLength(3)
    expect(screen.getByRole("combobox", { name: "Sort by" })).toHaveValue("newest")
  })

  it("eagerly loads only the first displayed mockup after sorting", async () => {
    const user = userEvent.setup()
    render(
      <ProductList
        catalog={{
          status: "ready",
          products: [
            { ...product, image: { src: "/featured.jpg", alt: "Featured mockup" } },
            {
              ...product,
              id: "newest",
              addedToShopAt: "2026-09-10T12:00:00.000Z",
              image: { src: "/newest.jpg", alt: "Newest mockup" },
            },
          ],
        }}
      />
    )
    expect(screen.getByRole("img", { name: "Featured mockup" })).toHaveAttribute("loading", "eager")
    expect(screen.getByRole("img", { name: "Featured mockup" })).toHaveAttribute("fetchpriority", "high")
    expect(screen.getByRole("img", { name: "Newest mockup" })).toHaveAttribute("loading", "lazy")

    await user.selectOptions(screen.getByRole("combobox", { name: "Sort by" }), "newest")

    expect(screen.getByRole("img", { name: "Newest mockup" })).toHaveAttribute("loading", "eager")
    expect(screen.getByRole("img", { name: "Newest mockup" })).toHaveAttribute("fetchpriority", "high")
    expect(screen.getByRole("img", { name: "Featured mockup" })).toHaveAttribute("loading", "lazy")
    expect(screen.getByRole("img", { name: "Featured mockup" })).not.toHaveAttribute("fetchpriority")
  })

  it("distinguishes an empty selection from a connection failure", () => {
    const { rerender } = render(<ProductList catalog={{ status: "empty", products: [] }} />)

    expect(screen.getByText(/Our first collection is on its way/)).toBeInTheDocument()
    expect(screen.queryByRole("status")).not.toBeInTheDocument()

    rerender(<ProductList catalog={{ status: "unavailable", products: [] }} />)

    expect(screen.getByRole("status")).toHaveTextContent("The shop is taking a quick breather. Please try again soon.")
    expect(screen.queryByText(/Our first collection is on its way/)).not.toBeInTheDocument()
    expect(screen.queryByRole("list")).not.toBeInTheDocument()
  })

  it("preserves successful products with an explanation when others fail", () => {
    render(<ProductList catalog={{ status: "partial", products: [product] }} />)

    expect(screen.getByRole("status")).toHaveTextContent("Some products couldn’t load.")
    expect(screen.getByRole("heading", { name: product.title })).toBeInTheDocument()
    expect(screen.getByRole("list", { name: "Products" })).toBeInTheDocument()
  })

  it("renders selected products in the supplied order without an error notice", () => {
    render(
      <ProductList
        catalog={{
          status: "ready",
          products: [product, { ...product, id: "second-product", title: "Another graphic shirt" }],
        }}
      />
    )

    expect(screen.getAllByRole("heading").map((heading) => heading.textContent)).toEqual([
      "Sample graphic shirt",
      "Another graphic shirt",
    ])
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })

  it("sorts by shop arrival time and sales quantity and restores the exact featured order", async () => {
    const user = userEvent.setup()
    render(
      <ProductList
        catalog={{
          status: "ready",
          popularityStatus: "ready",
          products: [
            product,
            catalogProductFixture({
              id: "new",
              title: "Newest shirt",
              addedToShopAt: "2026-09-07T12:00:00.000Z",
              salesCount: 1,
            }),
            catalogProductFixture({
              id: "popular",
              title: "Popular shirt",
              addedToShopAt: "2026-08-01T12:00:00.000Z",
              salesCount: 20,
            }),
          ],
        }}
      />
    )
    const sort = screen.getByRole("combobox", { name: "Sort by" })
    await user.selectOptions(sort, "newest")
    expect(screen.getAllByRole("heading")[0]).toHaveTextContent("Newest shirt")
    await user.selectOptions(sort, "popular")
    expect(screen.getAllByRole("heading")[0]).toHaveTextContent("Popular shirt")
    await user.selectOptions(sort, "featured")
    expect(screen.getAllByRole("heading").map((heading) => heading.textContent)).toEqual([
      product.title,
      "Newest shirt",
      "Popular shirt",
    ])
  })

  it("leads Featured with this week's drop but orders Newest purely by when each tee reached the shop", async () => {
    const user = userEvent.setup()
    render(
      <ProductList
        catalog={{
          status: "ready",
          products: [
            catalogProductFixture({ id: "early-a", title: "Early shirt A", addedToShopAt: "2026-09-10T12:00:00.000Z" }),
            catalogProductFixture({ id: "undated", title: "Undated shirt", addedToShopAt: null }),
            catalogProductFixture({ id: "tuesday", title: "Tuesday shirt", addedToShopAt: "2026-09-15T12:00:00.000Z" }),
            catalogProductFixture({ id: "early-b", title: "Early shirt B", addedToShopAt: "2026-09-10T12:00:00.000Z" }),
            catalogProductFixture({ id: "drop", title: "Drop shirt", addedToShopAt: "2026-09-14T12:00:00.000Z" }),
          ],
          designOfTheWeekProductIds: ["drop"],
        }}
      />
    )
    const titles = () => screen.getAllByRole("heading").map((heading) => heading.textContent)
    expect(titles()).toEqual(["Drop shirt", "Early shirt A", "Undated shirt", "Tuesday shirt", "Early shirt B"])

    await user.selectOptions(screen.getByRole("combobox", { name: "Sort by" }), "newest")

    // A tee the owner showed the day after the drop outranks the drop. Tees that arrived together keep
    // their Featured order, and the one with no arrival date follows every dated tee.
    expect(titles()).toEqual(["Tuesday shirt", "Drop shirt", "Early shirt A", "Early shirt B", "Undated shirt"])
  })

  it("explains missing arrival dates under Newest only", async () => {
    const user = userEvent.setup()
    const dated = catalogProductFixture({ id: "dated", title: "Dated shirt" })
    const { rerender } = render(<ProductList catalog={{ status: "ready", products: [product, dated] }} />)
    const sort = screen.getByRole("combobox", { name: "Sort by" })
    await user.selectOptions(sort, "newest")
    expect(screen.queryByRole("status")).not.toBeInTheDocument()

    rerender(<ProductList catalog={{ status: "ready", products: [product, { ...dated, addedToShopAt: null }] }} />)
    expect(screen.getByRole("status")).toHaveTextContent(
      "A few arrival dates couldn’t load. Those styles follow the newest arrivals."
    )

    await user.selectOptions(sort, "featured")
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })

  it("badges exactly the catalog's new products, and a drop tee only when it is new too", async () => {
    const user = userEvent.setup()
    render(
      <ProductList
        catalog={{
          status: "ready",
          products: [
            catalogProductFixture({
              id: "old-drop",
              title: "Returning drop shirt",
              addedToShopAt: "2026-08-01T12:00:00.000Z",
            }),
            catalogProductFixture({
              id: "new-drop",
              title: "Fresh drop shirt",
              addedToShopAt: "2026-09-14T12:00:00.000Z",
            }),
            catalogProductFixture({ id: "new", title: "Fresh shirt", addedToShopAt: "2026-09-20T12:00:00.000Z" }),
            catalogProductFixture({ id: "old", title: "Classic shirt" }),
          ],
          designOfTheWeekProductIds: ["old-drop", "new-drop"],
          newProductIds: ["new-drop", "new"],
        }}
      />
    )
    const badged = () =>
      screen
        .getAllByRole("article")
        .filter((card) => within(card).queryByText("New"))
        .map((card) => within(card).getByRole("heading").textContent)
    expect(badged()).toEqual(["Fresh drop shirt", "Fresh shirt"])

    // The badge travels with the tee, not with a position in the grid.
    await user.selectOptions(screen.getByRole("combobox", { name: "Sort by" }), "newest")
    expect(badged()).toEqual(["Fresh shirt", "Fresh drop shirt"])
  })

  it("requires selected color and size to coexist on an available variant", async () => {
    const user = userEvent.setup()
    render(<ProductList catalog={{ status: "ready", products: [product] }} />)
    await user.click(screen.getByRole("button", { name: "Filters +" }))
    await user.click(screen.getByRole("checkbox", { name: "Black" }))
    await user.click(screen.getByRole("checkbox", { name: "M" }))
    expect(screen.queryByRole("list", { name: "Products" })).not.toBeInTheDocument()
    expect(screen.getByText("No products match that combination.")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Clear filters" }))
    expect(screen.getByRole("article")).toBeInTheDocument()
  })

  it("keeps featured order and explains unavailable popularity instead of inventing best sellers", async () => {
    const user = userEvent.setup()
    render(
      <ProductList
        catalog={{
          status: "ready",
          popularityStatus: "unavailable",
          products: [catalogProductFixture({ salesCount: null })],
        }}
      />
    )
    await user.selectOptions(screen.getByRole("combobox", { name: "Sort by" }), "popular")
    expect(screen.getByRole("status")).toHaveTextContent("Showing our featured order for now")
    expect(screen.getByRole("heading")).toHaveTextContent(product.title)
  })
})

it.each(["Art for the everyday.", "Night-owl originals."])(
  "uses the configured tagline in the shop sidebar: %s",
  (tagline) => {
    storeConfig.tagline = tagline
    render(<ProductList catalog={{ status: "ready", products: [product] }} />)
    expect(
      within(screen.getByRole("complementary", { name: "Filter products" })).getByText(tagline)
    ).toBeInTheDocument()
    expect(screen.queryByText(/Snack breaks welcome/)).not.toBeInTheDocument()
  }
)
