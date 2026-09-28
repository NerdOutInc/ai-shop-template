import type { Meta, StoryObj } from "@storybook/nextjs-vite"
import { expect, userEvent, within } from "storybook/test"

import { storeConfig } from "@/lib/store-config"

import type { CatalogProduct } from "./catalog-product"
import { ProductList } from "./product-list"

function catalogProductFixture(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    id: "sample-product",
    title: "Sample graphic shirt",
    description: "An illustrative shirt for catalog tests.",
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

const sampleImage = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800"><rect width="800" height="800" fill="#ededed"/><path d="M270 180 160 260 230 370 280 340V620H520V340L570 370 640 260 530 180 460 210H340Z" fill="#595959"/><text x="400" y="400" text-anchor="middle" font-family="sans-serif" font-size="30" fill="#fafafa">Sample shirt</text><text x="400" y="720" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#595959">Illustrative test image</text></svg>'
)}`

const product = catalogProductFixture({
  id: "sample-shirt",
  title: "Sample graphic shirt",
  image: { src: sampleImage, alt: "Illustrative sample shirt, not a production mockup" },
})

const meta = {
  title: "Catalog/Product list",
  component: ProductList,
  parameters: { layout: "padded", productSelectionUrl: true },
  args: { catalog: { status: "ready", products: [product] } },
  beforeEach: () => {
    const previous = storeConfig.configured
    storeConfig.configured = true
    return () => {
      storeConfig.configured = previous
    }
  },
  decorators: [
    (Story) => (
      <main>
        <h1 className="mb-8 text-4xl font-black tracking-tight">Shop</h1>
        <Story />
      </main>
    ),
  ],
} satisfies Meta<typeof ProductList>

export default meta

type Story = StoryObj<typeof meta>

export const Populated: Story = {
  args: {
    catalog: {
      status: "ready",
      products: [
        product,
        {
          ...product,
          id: "sample-range",
          title: "Another sample shirt",
          price: { currency: "USD", min: 2700, max: 3200 },
        },
      ],
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole("article")).toHaveLength(2)
    await expect(canvas.getByText("$25.00")).toBeVisible()
    await expect(canvas.getByText("From $27.00")).toBeVisible()
    await expect(canvas.getAllByRole("button", { name: "Black" })).toHaveLength(2)
    await expect(canvas.getAllByRole("link")).toHaveLength(2)
    await expect(canvas.getByRole("combobox", { name: "Sort by" })).toBeVisible()
  },
}

export const Empty: Story = {
  args: { catalog: { status: "empty", products: [] } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/Our first collection is on its way/)).toBeVisible()
    await expect(canvas.queryByRole("list")).not.toBeInTheDocument()
  },
}

export const ConnectionError: Story = {
  args: { catalog: { status: "unavailable", products: [] } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status")).toHaveTextContent("The shop is taking a quick breather.")
    await expect(canvas.queryByText(/Our first collection is on its way/)).not.toBeInTheDocument()
  },
}

export const Partial: Story = {
  args: { catalog: { status: "partial", products: [product] } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status")).toHaveTextContent("Some products couldn’t load.")
    await expect(canvas.getByRole("article", { name: product.title })).toBeVisible()
  },
}

export const UnavailableProduct: Story = {
  args: {
    catalog: { status: "ready", products: [{ ...product, availability: "unavailable", price: null, options: [] }] },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Currently unavailable")).toBeVisible()
    await expect(canvas.getByRole("heading", { name: product.title })).toBeVisible()
    await expect(canvas.queryByText(/\$/)).not.toBeInTheDocument()
  },
}

export const MissingImage: Story = {
  args: { catalog: { status: "ready", products: [{ ...product, image: null }] } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Product image coming soon")).toBeVisible()
    await expect(canvas.queryByAltText(/Illustrative sample/)).not.toBeInTheDocument()
    await expect(canvas.getByText("$25.00")).toBeVisible()
  },
}

export const SortingAndFilters: Story = {
  args: {
    catalog: {
      status: "ready",
      popularityStatus: "ready",
      products: [
        product,
        catalogProductFixture({
          id: "new-shirt",
          title: "Newest shirt",
          image: product.image,
          addedToShopAt: "2026-09-15T12:00:00.000Z",
          salesCount: 10,
        }),
        catalogProductFixture({
          id: "drop-shirt",
          title: "Drop shirt",
          image: product.image,
          addedToShopAt: "2026-09-14T12:00:00.000Z",
          salesCount: 1,
        }),
      ],
      // This week's drop leads Featured only. The owner showed Newest shirt the day after the drop,
      // so it is the newest arrival; the catalog marks both as new.
      designOfTheWeekProductIds: ["drop-shirt"],
      newProductIds: ["new-shirt", "drop-shirt"],
    },
  },
  play: async ({ canvas }) => {
    const sort = canvas.getByRole("combobox", { name: "Sort by" })
    const cards = () => canvas.getAllByRole("article")
    const titles = () => cards().map((card) => within(card).getByRole("heading").textContent)
    await expect(titles()).toEqual(["Drop shirt", product.title, "Newest shirt"])
    await expect(
      cards()
        .filter((card) => within(card).queryByText("New"))
        .map((card) => within(card).getByRole("heading").textContent)
    ).toEqual(["Drop shirt", "Newest shirt"])

    await userEvent.selectOptions(sort, "newest")
    await expect(titles()).toEqual(["Newest shirt", "Drop shirt", product.title])
    await expect(canvas.queryByRole("status")).not.toBeInTheDocument()
    await userEvent.selectOptions(sort, "popular")
    await expect(titles()).toEqual(["Newest shirt", product.title, "Drop shirt"])
    await userEvent.selectOptions(sort, "featured")
    await expect(titles()).toEqual(["Drop shirt", product.title, "Newest shirt"])

    const toggle = canvas.queryByRole("button", { name: "Filters +" })
    if (toggle) await userEvent.click(toggle)
    await userEvent.click(canvas.getByRole("checkbox", { name: "Black" }))
    await userEvent.click(canvas.getByRole("checkbox", { name: "M" }))
    await expect(canvas.getByText("No products match that combination.")).toBeVisible()
    await userEvent.click(canvas.getByRole("button", { name: "Clear filters" }))
    await expect(canvas.getAllByRole("article")).toHaveLength(3)
  },
}

export const CategoryFilters: Story = {
  args: {
    catalog: {
      status: "ready",
      products: [
        {
          ...product,
          garment: {
            manufacturer: "Next Level",
            model: "6210",
            categoryName: "T-shirts",
            categorySlug: "t-shirts",
            categorySortPosition: 1,
            gender: "unisex",
          },
        },
        {
          ...product,
          id: "crop-top",
          title: "Festival crop top",
          addedToShopAt: "2026-09-15T12:00:00.000Z",
          garment: {
            manufacturer: "Next Level",
            model: "5080",
            categoryName: "Crop tops",
            categorySlug: "crop-tops",
            categorySortPosition: 3,
            gender: "female",
          },
          variants: [product.variants[1]!],
        },
        { ...product, id: "unassigned", title: "Unassigned garment" },
      ],
    },
  },
  play: async ({ canvas }) => {
    const tee = canvas.getByRole("button", { name: "T-shirts" })
    const crop = canvas.getByRole("button", { name: "Crop tops" })
    const sort = canvas.getByRole("combobox", { name: "Sort by" })
    await expect(tee).toHaveAttribute("aria-pressed", "false")
    await expect(crop).toHaveAttribute("aria-pressed", "false")
    await expect(canvas.getByText("3 good things to wear")).toBeVisible()

    await userEvent.selectOptions(sort, "newest")
    await userEvent.click(tee)
    await expect(canvas.getByText("1 good thing to wear")).toBeVisible()
    await expect(canvas.getByRole("article")).toHaveAccessibleName(product.title)
    await userEvent.click(crop)
    await expect(tee).toHaveAttribute("aria-pressed", "true")
    await expect(crop).toHaveAttribute("aria-pressed", "true")
    await expect(canvas.getAllByRole("article").map((card) => within(card).getByRole("heading").textContent)).toEqual([
      "Festival crop top",
      product.title,
    ])

    const filterToggle = canvas.queryByRole("button", { name: "Filters +" })
    if (filterToggle) await userEvent.click(filterToggle)
    await userEvent.click(canvas.getByRole("checkbox", { name: "S" }))
    await userEvent.click(canvas.getByRole("checkbox", { name: "Black" }))
    await expect(canvas.getByRole("article")).toHaveAccessibleName(product.title)
    await userEvent.click(canvas.getByRole("button", { name: "Clear all" }))
    await expect(tee).toHaveAttribute("aria-pressed", "false")
    await expect(crop).toHaveAttribute("aria-pressed", "false")
    await expect(canvas.getByRole("checkbox", { name: "S" })).not.toBeChecked()
    await expect(canvas.getByRole("checkbox", { name: "Black" })).not.toBeChecked()
    await expect(canvas.getAllByRole("article")).toHaveLength(3)
    await expect(sort).toHaveValue("newest")
  },
}

export const MissingArrivalDates: Story = {
  args: {
    catalog: {
      status: "ready",
      products: [
        catalogProductFixture({ ...product, id: "undated-shirt", title: "Undated shirt", addedToShopAt: null }),
        product,
      ],
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole("status")).not.toBeInTheDocument()
    await userEvent.selectOptions(canvas.getByRole("combobox", { name: "Sort by" }), "newest")
    await expect(canvas.getByRole("status")).toHaveTextContent("A few arrival dates couldn’t load.")
    await expect(canvas.getAllByRole("article").map((card) => within(card).getByRole("heading").textContent)).toEqual([
      product.title,
      "Undated shirt",
    ])
  },
}

export const BeforeLaunch: Story = {
  args: { catalog: { status: "unavailable", products: [] } },
  beforeEach: () => {
    storeConfig.configured = false
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/Our first collection is on its way/)).toBeVisible()
    await expect(canvas.queryByText(/quick breather/)).not.toBeInTheDocument()
  },
}
