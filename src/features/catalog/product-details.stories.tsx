import type { Meta, StoryObj } from "@storybook/nextjs-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"

import { CartProvider } from "@/features/cart/cart-provider"

import printifySizeGuideDescriptions from "../../../test/printify-size-guide-descriptions.json"

import type { CatalogProduct } from "./catalog-product"
import { ProductDetails } from "./product-details"
import { readProductDescription } from "./read-product-description"

const sampleImage = (color: string, label: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#eff3f0"/><path d="M270 180 160 260 230 370 280 340V620H520V340L570 370 640 260 530 180 460 210H340Z" fill="${color}"/><text x="400" y="710" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#17262d">Illustrative test image: ${label}</text></svg>`)}`
const sampleArtwork = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="700"><circle cx="300" cy="260" r="180" fill="#f7edce"/><text x="300" y="520" text-anchor="middle" font-family="sans-serif" font-size="70" font-weight="bold" fill="#f7edce">SAMPLE SCENE</text></svg>')}`
const product: CatalogProduct = {
  id: "111111000000000000000002",
  title: "Sample Morning Scene — Fixture Store | Next Level 6210",
  garment: {
    manufacturer: "Next Level",
    model: "6210",
    categorySlug: "t-shirts",
    categoryName: "T-shirts",
    categorySortPosition: 1,
    gender: "unisex" as const,
  },
  description: "Soft fabric. Good company. Illustrative test product.",
  addedToShopAt: "2026-09-01T12:00:00.000Z",
  salesCount: 2,
  image: null,
  images: [],
  price: { currency: "USD", min: 2500, max: 2800 },
  options: [],
  variants: [
    {
      id: 2,
      title: "Black / 2XL",
      price: 2800,
      currency: "USD",
      available: true,
      color: "Black",
      size: "2XL",
      options: [],
    },
    {
      id: 1,
      title: "Black / S",
      price: 2500,
      currency: "USD",
      available: true,
      color: "Black",
      size: "S",
      options: [],
    },
    {
      id: 4,
      title: "Black / M",
      price: 2500,
      currency: "USD",
      available: false,
      color: "Black",
      size: "M",
      options: [],
    },
    {
      id: 3,
      title: "Heather Grey / M",
      price: 2700,
      currency: "USD",
      available: true,
      color: "Heather Grey",
      size: "M",
      options: [],
    },
  ],
  colors: [
    { name: "Black", hex: "#222222" },
    { name: "Heather Grey", hex: "#aaaaaa" },
  ],
  sizeGuide: {
    sizes: ["S", "M", "2XL"],
    measurements: [
      { label: "Width, in", values: ["19.00", "20.50", "26.00"] },
      { label: "Size tolerance, in", values: ["1.00", "1.00", "1.00"] },
    ],
  },
  availability: "available",
}
const meta = {
  title: "Catalog/Product details",
  component: ProductDetails,
  parameters: {
    layout: "padded",
    productSelectionUrl: true,
    // Each interactive Docs story needs its own browser URL context.
    docs: { story: { inline: false, iframeHeight: "1100px" } },
  },
  args: { product },
  decorators: [
    (Story) => (
      <CartProvider>
        <main className="page-width">
          <Story />
        </main>
      </CartProvider>
    ),
  ],
} satisfies Meta<typeof ProductDetails>
export default meta
type Story = StoryObj<typeof meta>

function productWithPrintifySizeGuide(name: string): CatalogProduct {
  const fixture = printifySizeGuideDescriptions.find((item) => item.name === name)!
  return {
    ...product,
    id: fixture.id,
    title: fixture.title,
    ...readProductDescription(fixture.description),
    colors: [{ name: "Black", hex: "#222222" }],
    variants: fixture.sizeGuide.sizes.map((size, index) => ({
      id: index + 1,
      title: `Black / ${size}`,
      price: 2500,
      currency: "USD",
      available: true,
      color: "Black",
      size,
      options: [],
    })),
  }
}

const verifyPrintifySizeGuide: NonNullable<Story["play"]> = async ({ args, canvas, canvasElement }) => {
  const fixture = printifySizeGuideDescriptions.find((item) => item.id === args.product.id)!
  const introduction = canvasElement.querySelector(".product-story")!
  await expect(introduction.textContent).toBe(fixture.introduction)
  await expect(introduction).toBeVisible()
  await expect(canvas.getByRole("table")).not.toBeVisible()

  const findYourFit = canvas.getByRole("button", { name: "Find your fit" })
  findYourFit.focus()
  await expect(findYourFit).toHaveFocus()
  await userEvent.keyboard("{Enter}")
  const summary = canvas.getByText("Size guide", { exact: true })
  await expect(summary).toHaveFocus()
  await expect(getComputedStyle(summary).outlineStyle).not.toBe("none")

  const table = within(canvas.getByRole("table"))
  await expect(table.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
    "Measurement",
    ...fixture.sizeGuide.sizes,
  ])
  await expect(table.getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual(
    fixture.sizeGuide.measurements.map((row) => row.label)
  )
  for (const measurement of fixture.sizeGuide.measurements) {
    const row = table.getByRole("rowheader", { name: measurement.label }).closest("tr")!
    await expect(
      within(row)
        .getAllByRole("cell")
        .map((cell) => cell.textContent)
    ).toEqual(measurement.values)
  }
  await userEvent.tab()
  await expect(canvas.getByRole("region", { name: "Size chart, scroll horizontally for more sizes" })).toHaveFocus()
}

async function waitForGalleryToSettle(canvasElement: HTMLElement) {
  const viewport = canvasElement.querySelector('[data-slot="carousel-content"]')!
  await waitFor(() => {
    const slide = viewport.querySelector('[data-slot="carousel-item"][aria-hidden="false"]')!
    expect(Math.abs(slide.getBoundingClientRect().left - viewport.getBoundingClientRect().left)).toBeLessThan(1)
  })
}

export const SelectAndAdd: Story = {
  play: async ({ canvas, canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    const iframeUrl = window.location.href
    await expect(canvas.getByRole("button", { name: "Choose a size" })).toBeDisabled()
    await expect(canvas.getByRole("button", { name: "M" })).toBeDisabled()
    await userEvent.click(canvas.getByRole("button", { name: "S" }))
    await userEvent.click(canvas.getByRole("button", { name: "Heather Grey" }))
    await expect(canvas.getByRole("button", { name: "Choose a size" })).toBeDisabled()
    await userEvent.click(canvas.getByRole("button", { name: "M" }))
    await expect(canvas.getByText("$27.00")).toBeVisible()
    const addButton = canvas.getByRole("button", { name: "Add to cart" })
    addButton.focus()
    await userEvent.keyboard("{Enter}")
    const confirmation = within(await page.findByRole("dialog", { name: "Added to cart" }))
    await waitFor(() => expect(confirmation.getByText("Sample Morning Scene", { exact: true })).toBeVisible())
    await expect(confirmation.getByText("Heather Grey / M", { exact: true })).toBeVisible()
    await expect(confirmation.getByText("Quantity: 1", { exact: true })).toBeVisible()
    await expect(confirmation.getByText("$27.00", { exact: true })).toBeVisible()
    const viewCart = confirmation.getByRole("link", { name: /^View cart \(\d+\)$/ })
    await expect(viewCart).toHaveAttribute("href", "/cart")
    await waitFor(() => expect(viewCart).toHaveFocus())
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(page.queryByRole("dialog")).not.toBeInTheDocument())
    await waitFor(() => expect(addButton).toHaveFocus())
    await expect(addButton).toHaveAccessibleName("Add to cart")
    const selection = new URLSearchParams(canvas.getByTestId("product-selection-url").dataset.search)
    await expect(selection.get("color")).toBe("Heather Grey")
    await expect(selection.get("size")).toBe("M")
    await expect(window.location.href).toBe(iframeUrl)
  },
}

export const FestivalCropTop: Story = {
  args: {
    product: {
      ...product,
      title: "Sample Abstract Lines - Women's Festival Crop Top",
      garment: {
        manufacturer: "Next Level",
        model: "5080",
        categorySlug: "crop-tops",
        categoryName: "Crop tops",
        categorySortPosition: 3,
        gender: "female",
      },
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Next Level 5080", { exact: true })).toBeVisible()
    await expect(canvas.getByText("Women's crop top", { exact: true })).toBeVisible()
    await expect(canvas.queryByText("Next Level 6210", { exact: true })).not.toBeInTheDocument()
    const size = canvas.getByRole("button", { name: /^S$/ })
    size.focus()
    await userEvent.keyboard("{Enter}")
    await expect(size).toHaveAttribute("aria-pressed", "true")
    await expect(canvas.getByRole("button", { name: "Add to cart" })).toBeEnabled()
  },
}

export const SharedColorAndSize: Story = {
  args: {
    product: { ...product, defaultColor: "Black", colors: [product.colors[1]!, product.colors[0]!] },
  },
  parameters: { productSelection: { color: "Heather Grey", size: "M" } },
  play: async ({ canvas }) => {
    const iframeUrl = window.location.href
    await expect(canvas.getByRole("button", { name: "Heather Grey" })).toHaveAttribute("aria-pressed", "true")
    await expect(canvas.getByRole("button", { name: "M" })).toHaveAttribute("aria-pressed", "true")
    await expect(canvas.getByRole("button", { name: "Add to cart" })).toBeEnabled()
    await expect(canvas.getByText("$27.00")).toBeVisible()
    const colorOptions = within(canvas.getByRole("group", { name: /^Color/ })).getAllByRole("button")
    await expect(colorOptions.map((option) => option.getAttribute("aria-label"))).toEqual(["Black", "Heather Grey"])

    await userEvent.click(canvas.getByRole("button", { name: "Black" }))
    await expect(canvas.getByRole("button", { name: "Choose a size" })).toBeDisabled()
    await userEvent.click(canvas.getByRole("button", { name: "S" }))
    const selection = new URLSearchParams(canvas.getByTestId("product-selection-url").dataset.search)
    await expect(selection.get("color")).toBe("Black")
    await expect(selection.get("size")).toBe("S")
    await expect(window.location.href).toBe(iframeUrl)
  },
}

export const GalleryAndSizeGuide: Story = {
  args: {
    product: {
      ...product,
      artwork: { src: sampleArtwork, alt: "Illustrative Sample Morning Scene artwork", backgroundColor: "#222222" },
      images: [
        { src: sampleImage("#222222", "Black front"), alt: "Black shirt front", variantIds: [1, 2] },
        { src: sampleImage("#222222", "Black back"), alt: "Black shirt back", variantIds: [1, 2] },
        { src: sampleImage("#aaaaaa", "Heather Grey front"), alt: "Heather Grey shirt front", variantIds: [3] },
      ],
    },
  },
  play: async ({ canvas, canvasElement }) => {
    await userEvent.click(canvas.getByRole("button", { name: "View photo 2 of Sample Morning Scene" }))
    await expect(canvas.getByRole("img", { name: "Black shirt back" })).toBeVisible()
    await userEvent.tab()
    await expect(canvas.getByRole("button", { name: "View artwork of Sample Morning Scene" })).toHaveFocus()
    await userEvent.keyboard("{Enter}")
    await expect(canvas.getByRole("img", { name: "Illustrative Sample Morning Scene artwork" })).toBeVisible()
    await expect(
      canvas.getByRole("img", { name: "Illustrative Sample Morning Scene artwork" }).parentElement
    ).toHaveStyle({
      backgroundColor: "#222222",
    })
    await userEvent.click(canvas.getByRole("button", { name: "Heather Grey" }))
    await expect(canvas.getByRole("button", { name: "View artwork of Sample Morning Scene" })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
    await expect(canvas.getByRole("img", { name: "Illustrative Sample Morning Scene artwork" })).toBeVisible()
    await expect(
      canvas.getByRole("img", { name: "Illustrative Sample Morning Scene artwork" }).parentElement
    ).toHaveStyle({
      backgroundColor: "#aaaaaa",
    })
    await userEvent.click(canvas.getByRole("button", { name: "Find your fit" }))
    await expect(canvas.getByText("Size guide")).toHaveFocus()
    await expect(canvas.getByRole("columnheader", { name: "M" })).toBeVisible()
    await expect(canvas.getByRole("cell", { name: "20.50" })).toBeVisible()
    await expect(canvas.queryByText(/size tolerance/i)).not.toBeInTheDocument()
    await waitForGalleryToSettle(canvasElement)
  },
}

export const CarouselNavigation: Story = {
  args: GalleryAndSizeGuide.args,
  play: async ({ canvas, canvasElement }) => {
    const gallery = canvas.getByRole("region", { name: "Sample Morning Scene photos" })
    const firstPhoto = canvas.getByRole("button", { name: "View photo 1 of Sample Morning Scene" })
    const secondPhoto = canvas.getByRole("button", { name: "View photo 2 of Sample Morning Scene" })
    const artwork = canvas.getByRole("button", { name: "View artwork of Sample Morning Scene" })
    gallery.focus()
    await userEvent.keyboard("{ArrowRight}")
    await expect(gallery).toHaveFocus()
    await waitFor(() => expect(secondPhoto).toHaveAttribute("aria-pressed", "true"))
    await expect(canvas.getByRole("img", { name: "Black shirt back" })).toBeVisible()
    await userEvent.keyboard("{ArrowRight}")
    await waitFor(() => expect(artwork).toHaveAttribute("aria-pressed", "true"))
    await userEvent.keyboard("{ArrowRight}")
    await waitFor(() => expect(firstPhoto).toHaveAttribute("aria-pressed", "true"))
    await userEvent.keyboard("{ArrowLeft}")
    await waitFor(() => expect(artwork).toHaveAttribute("aria-pressed", "true"))
    await userEvent.click(canvas.getByRole("button", { name: "Previous slide" }))
    await waitFor(() => expect(secondPhoto).toHaveAttribute("aria-pressed", "true"))
    await userEvent.click(canvas.getByRole("button", { name: "Next slide" }))
    await waitFor(() => expect(artwork).toHaveAttribute("aria-pressed", "true"))
    await userEvent.click(canvas.getByRole("button", { name: "Heather Grey" }))
    await expect(canvas.getByRole("button", { name: "View artwork of Sample Morning Scene" })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
    await expect(canvas.getByRole("img", { name: "Illustrative Sample Morning Scene artwork" })).toBeVisible()
    await expect(
      canvas.getByRole("img", { name: "Illustrative Sample Morning Scene artwork" }).parentElement
    ).toHaveStyle({
      backgroundColor: "#aaaaaa",
    })
    await waitForGalleryToSettle(canvasElement)
  },
}

export const KeepSelectedViewAcrossColors: Story = {
  args: {
    product: {
      ...product,
      artwork: { src: sampleArtwork, alt: "Illustrative Sample Morning Scene artwork", backgroundColor: "#222222" },
      images: [
        {
          src: sampleImage("#222222", "Black front"),
          alt: "Black shirt front",
          variantIds: [1, 2],
          viewKey: "front",
        },
        {
          src: sampleImage("#222222", "Black back"),
          alt: "Black shirt back",
          variantIds: [1, 2],
          viewKey: "back",
        },
        {
          src: sampleImage("#aaaaaa", "Heather Grey back"),
          alt: "Heather Grey shirt back",
          variantIds: [3],
          viewKey: "back",
        },
        {
          src: sampleImage("#aaaaaa", "Heather Grey front"),
          alt: "Heather Grey shirt front",
          variantIds: [3],
          viewKey: "front",
        },
        {
          src: sampleImage("#aaaaaa", "Heather Grey detail"),
          alt: "Heather Grey shirt detail",
          variantIds: [3],
          viewKey: "detail",
        },
      ],
    },
  },
  play: async ({ canvas, canvasElement }) => {
    const secondPhoto = canvas.getByRole("button", { name: "View photo 2 of Sample Morning Scene" })
    secondPhoto.focus()
    await userEvent.keyboard("{Enter}")
    await waitFor(() => expect(secondPhoto).toHaveAttribute("aria-pressed", "true"))
    await expect(secondPhoto).toHaveFocus()
    await expect(getComputedStyle(secondPhoto).outlineStyle).not.toBe("none")
    await expect(canvas.getByRole("img", { name: "Black shirt back" })).toBeVisible()
    await userEvent.click(canvas.getByRole("button", { name: "Black" }))
    await expect(secondPhoto).toHaveAttribute("aria-pressed", "true")

    const grey = canvas.getByRole("button", { name: "Heather Grey" })
    grey.focus()
    await userEvent.keyboard("{Enter}")
    await expect(grey).toHaveFocus()
    await expect(getComputedStyle(grey).outlineStyle).not.toBe("none")
    await expect(canvas.getByRole("button", { name: "View photo 1 of Sample Morning Scene" })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
    await expect(canvas.getByRole("img", { name: "Heather Grey shirt back" })).toBeVisible()
    await waitForGalleryToSettle(canvasElement)

    await userEvent.click(canvas.getByRole("button", { name: "View artwork of Sample Morning Scene" }))
    await userEvent.click(canvas.getByRole("button", { name: "Black" }))
    await expect(canvas.getByRole("button", { name: "View artwork of Sample Morning Scene" })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
    await expect(
      canvas.getByRole("img", { name: "Illustrative Sample Morning Scene artwork" }).parentElement
    ).toHaveStyle({
      backgroundColor: "#222222",
    })
    await waitForGalleryToSettle(canvasElement)
    await userEvent.click(grey)
    await userEvent.click(canvas.getByRole("button", { name: "View photo 3 of Sample Morning Scene" }))
    await expect(canvas.getByRole("img", { name: "Heather Grey shirt detail" })).toBeVisible()
    await userEvent.click(canvas.getByRole("button", { name: "Black" }))
    await expect(canvas.getByRole("img", { name: "Black shirt front" })).toBeVisible()
    // Clicking the already-visible fallback chooses front even though the carousel does not move.
    await userEvent.click(canvas.getByRole("button", { name: "View photo 1 of Sample Morning Scene" }))
    await userEvent.click(grey)
    await expect(canvas.getByRole("button", { name: "View photo 2 of Sample Morning Scene" })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
    await expect(canvas.getByRole("img", { name: "Heather Grey shirt front" })).toBeVisible()
    await waitForGalleryToSettle(canvasElement)
  },
}

export const NewArrival: Story = {
  args: { ...GalleryAndSizeGuide.args, isNew: true },
  play: async ({ canvas, canvasElement }) => {
    const gallery = canvas.getByRole("region", { name: "Sample Morning Scene photos" })
    const badge = canvas.getByText("New")
    await expect(canvas.getAllByText("New")).toHaveLength(1)
    await expect(badge).toBeVisible()
    const frame = canvasElement.querySelector('[data-slot="carousel-content"]')!.getBoundingClientRect()
    const before = badge.getBoundingClientRect()
    await expect(before.top - frame.top).toBeCloseTo(8, 0)
    await expect(frame.right - before.right).toBeCloseTo(8, 0)

    // The slides scroll under the badge; the badge itself does not move.
    await userEvent.click(canvas.getByRole("button", { name: "Next slide" }))
    await waitFor(() =>
      expect(canvas.getByRole("button", { name: "View photo 2 of Sample Morning Scene" })).toHaveAttribute(
        "aria-pressed",
        "true"
      )
    )
    await waitForGalleryToSettle(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "View artwork of Sample Morning Scene" }))
    await waitForGalleryToSettle(canvasElement)
    await expect(canvas.getByRole("img", { name: "Illustrative Sample Morning Scene artwork" })).toBeVisible()
    await expect(badge).toBeVisible()
    await expect(gallery).toContainElement(badge)
    const after = badge.getBoundingClientRect()
    await expect(after.top).toBeCloseTo(before.top, 0)
    await expect(after.left).toBeCloseTo(before.left, 0)
  },
}

export const AdminPreview: Story = {
  args: { ...GalleryAndSizeGuide.args, preview: true },
  play: async ({ canvas, canvasElement }) => {
    const color = canvas.getByRole("button", { name: "Heather Grey" })
    color.focus()
    await expect(color).toHaveFocus()
    await userEvent.keyboard("{Enter}")
    await userEvent.click(canvas.getByRole("button", { name: "M" }))
    await expect(canvas.getByText("$27.00")).toBeVisible()
    await expect(canvas.getByRole("img", { name: "Heather Grey shirt front" })).toBeVisible()
    await expect(canvas.getByRole("button", { name: "Add to cart" })).toBeDisabled()
    await expect(canvas.getByRole("button", { name: "Add to cart" })).toHaveAccessibleDescription(
      "Purchasing is disabled in admin preview."
    )
    await userEvent.click(canvas.getByRole("button", { name: "View artwork of Sample Morning Scene" }))
    await expect(canvas.getByRole("img", { name: "Illustrative Sample Morning Scene artwork" })).toBeVisible()
    await userEvent.click(canvas.getByRole("button", { name: "Find your fit" }))
    await expect(canvas.getByText("Size guide")).toHaveFocus()
    await expect(canvas.getByRole("cell", { name: "20.50" })).toBeVisible()
    await expect(within(canvasElement.ownerDocument.body).queryByRole("dialog")).not.toBeInTheDocument()
    await waitForGalleryToSettle(canvasElement)
  },
}

export const FormattedDetails: Story = {
  args: {
    product: {
      ...product,
      ...readProductDescription(
        '<p><strong>The design</strong></p><p>A colorful garden with layered geometric shapes. Small details reward a closer look.</p><p><strong>The tee</strong></p><p>Printed on the <strong>Next Level 6210</strong>, a soft crewneck for everyday plans.</p><ul><li>60% combed, ring-spun cotton, 40% polyester</li><li>Lightweight 4.3 oz/yd² fabric</li><li>Classic fit</li><li>Tear-away label</li></ul><p><strong>Care</strong></p><ol><li>Machine wash cold</li><li>Tumble dry low</li></ol><table id="size-guide"><tr><th></th><th>S</th><th>M</th></tr><tr><td>Width, in</td><td>19.00</td><td>20.50</td></tr></table>'
      ),
    },
  },
  play: async ({ canvas }) => {
    const details = canvas.getByText("The garment")
    details.focus()
    await expect(details).toHaveFocus()
    await userEvent.click(details)
    const garment = within(details.closest("details")!)
    await expect(garment.getByText("Next Level 6210")).toBeVisible()
    await expect(garment.getByText("Next Level 6210").tagName).toBe("STRONG")
    await expect(garment.getAllByRole("list").map((list) => list.tagName)).toEqual(["UL"])
    await expect(garment.getAllByRole("listitem")).toHaveLength(4)
    for (const repeated of ["The design", "The tee", "Care", "Machine wash cold"])
      await expect(garment.queryByText(repeated)).not.toBeInTheDocument()
    await expect(canvas.getAllByText(/^A colorful garden with layered geometric shapes\./)).toHaveLength(1)
    await userEvent.click(canvas.getByRole("button", { name: "Find your fit" }))
    await expect(canvas.getByText("Size guide")).toHaveFocus()
    await expect(canvas.getByRole("cell", { name: "20.50" })).toBeVisible()
  },
}

export const OrganicHoodieSizeGuide: Story = {
  args: { product: productWithPrintifySizeGuide("hoodie") },
  play: verifyPrintifySizeGuide,
}

export const ConcertTankSizeGuide: Story = {
  args: { product: productWithPrintifySizeGuide("tank") },
  play: verifyPrintifySizeGuide,
}

export const FestivalCropTopSizeGuide: Story = {
  args: { product: productWithPrintifySizeGuide("crop") },
  play: verifyPrintifySizeGuide,
}

export const SoldOutPrimaryColor: Story = {
  args: {
    product: {
      ...product,
      defaultColor: "Heather Grey",
      image: { src: sampleImage("#aaaaaa", "Heather Grey front"), alt: "Heather Grey shirt front" },
      images: [
        { src: sampleImage("#aaaaaa", "Heather Grey front"), alt: "Heather Grey shirt front", variantIds: [3] },
        { src: sampleImage("#222222", "Black front"), alt: "Black shirt front", variantIds: [1, 2] },
      ],
      variants: product.variants.map((variant) => ({
        ...variant,
        available: variant.color === "Black" && variant.available,
      })),
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: "Heather Grey" })).toHaveAttribute("aria-pressed", "true")
    await expect(canvas.getByRole("img", { name: "Heather Grey shirt front" })).toBeVisible()
    await expect(canvas.getByRole("button", { name: "This color is unavailable" })).toBeDisabled()
    const black = canvas.getByRole("button", { name: "Black" })
    black.focus()
    await expect(black).toHaveFocus()
    await userEvent.keyboard("{Enter}")
    await expect(black).toHaveAttribute("aria-pressed", "true")
    await expect(canvas.getByRole("img", { name: "Black shirt front" })).toBeVisible()
    await expect(canvas.getByRole("button", { name: "S" })).toBeEnabled()
  },
}

export const Unavailable: Story = {
  args: {
    product: {
      ...product,
      availability: "unavailable",
      price: null,
      variants: product.variants.map((variant) => ({ ...variant, available: false })),
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: "Currently unavailable" })).toBeDisabled()
    await expect(canvas.queryByText(/^\$\d/)).not.toBeInTheDocument()
  },
}
