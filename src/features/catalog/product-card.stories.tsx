import type { Meta, StoryObj } from "@storybook/nextjs-vite"
import { expect, fireEvent, userEvent, waitFor } from "storybook/test"

import type { CatalogProduct } from "./catalog-product"
import { ProductCard } from "./product-card"

const sampleImage = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><path d="M270 180 160 260 230 370 280 340V620H520V340L570 370 640 260 530 180 460 210H340Z" fill="#222222"/><text x="400" y="710" text-anchor="middle" font-family="sans-serif" font-size="24">Illustrative shirt mockup</text></svg>')}`
const sampleArtwork = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><circle cx="256" cy="256" r="170" fill="none" stroke="#ffffff" stroke-width="20"/><path d="M256 126 291 214l95 6-74 60 24 93-80-52-80 52 24-93-74-60 95-6Z" fill="#ffffff"/></svg>')}`
const product: CatalogProduct = {
  id: "artwork-preview",
  title: "Artwork preview",
  description: "Illustrative shirt with an approved artwork preview.",
  addedToShopAt: null,
  salesCount: null,
  image: { src: sampleImage, alt: "Illustrative shirt mockup" },
  artwork: {
    src: sampleArtwork,
    alt: "Illustrative star artwork",
    backgroundColor: "#222222",
  },
  images: [],
  price: { currency: "USD", min: 2500, max: 2500 },
  options: [],
  variants: [],
  colors: [],
  sizeGuide: null,
  availability: "available",
}
const meta = {
  title: "Catalog/Product card",
  component: ProductCard,
  args: { product },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 480 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ProductCard>
export default meta
type Story = StoryObj<typeof meta>

const previewColors = [
  { name: "Black", hex: "#222222" },
  { name: "Indigo", hex: "#32404e" },
  { name: "Cream", hex: "#ded1be" },
  { name: "Warm Gray", hex: "#928984" },
  { name: "Forest Green", hex: "#2a4f4f" },
]
const colorImages = previewColors.map((color, index) => ({
  src: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><path d="M270 180 160 260 230 370 280 340V620H520V340L570 370 640 260 530 180 460 210H340Z" fill="${color.hex}"/><text x="400" y="710" text-anchor="middle" font-family="sans-serif" font-size="24">${color.name} shirt mockup</text></svg>`)}`,
  alt: `${color.name} shirt mockup`,
  variantIds: [index + 1],
}))

export const SelectColor: Story = {
  args: {
    product: {
      ...product,
      defaultColor: "Black",
      image: colorImages[0]!,
      images: colorImages,
      colors: previewColors,
      variants: previewColors.map((color, index) => ({
        id: index + 1,
        title: `${color.name} / M`,
        price: 2500,
        currency: "USD",
        available: true,
        color: color.name,
        size: "M",
        options: [],
      })),
    },
  },
  render: (args) => (
    <div style={{ width: "100%", maxWidth: 320 }}>
      <ProductCard {...args} />
    </div>
  ),
  play: async ({ canvas, canvasElement }) => {
    const link = canvas.getByRole("link", { name: "Artwork preview" })
    const artwork = canvas.getByAltText("Illustrative star artwork")
    const black = canvas.getByRole("button", { name: "Black" })
    const indigo = canvas.getByRole("button", { name: "Indigo" })
    const colors = canvas.getByRole("group", { name: "Available colors" })
    if ("__vitest_browser__" in globalThis) {
      const { commands } = await import("vitest/browser")
      if ("resetMousePosition" in commands && typeof commands.resetMousePosition === "function") {
        await commands.resetMousePosition()
      }
    }
    canvasElement.tabIndex = -1
    canvasElement.focus()
    await expect(black).toHaveAttribute("aria-pressed", "true")
    await expect(link).toHaveAttribute("href", "/shop/artwork-preview?color=Black")
    await expect(canvas.getByAltText("Black shirt mockup")).toBeVisible()
    await expect(canvas.getAllByRole("button")).toHaveLength(5)

    await userEvent.tab()
    await expect(link).toHaveFocus()
    await userEvent.tab()
    await expect(black).toHaveFocus()
    await userEvent.tab()
    await expect(indigo).toHaveFocus()
    await expect(getComputedStyle(indigo).outlineStyle).not.toBe("none")
    await userEvent.keyboard(" ")
    await expect(indigo).toHaveAttribute("aria-pressed", "true")
    await expect(link).toHaveAttribute("href", "/shop/artwork-preview?color=Indigo")
    await expect(black).toHaveAttribute("aria-pressed", "false")
    await expect(canvas.getByAltText("Indigo shirt mockup")).toBeVisible()
    await expect(getComputedStyle(indigo).borderTopColor).toBe(getComputedStyle(indigo).outlineColor)

    for (const [index, color] of previewColors.entries()) {
      const swatch = canvas.getByRole("button", { name: color.name })
      await userEvent.click(swatch)
      await expect(swatch).toHaveAttribute("aria-pressed", "true")
      await expect(canvas.getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual(
        previewColors.map((item) => item.name)
      )
      const destination = new URL(link.getAttribute("href")!, "https://example.com")
      await expect(destination.searchParams.get("color")).toBe(color.name)
      await expect(destination.searchParams.has("size")).toBe(false)
      await expect(canvas.getByAltText(`${color.name} shirt mockup`)).toBeVisible()
      for (let previous = 0; previous <= index; previous += 1) await userEvent.tab({ shift: true })
      await expect(link).toHaveFocus()
      await waitFor(() => expect(artwork).toBeVisible())
      await expect(artwork.parentElement).toHaveStyle({ backgroundColor: color.hex })
      await expect(canvas.getByAltText(`${color.name} shirt mockup`)).not.toBeVisible()
      await expect(swatch.getBoundingClientRect().width).toBeGreaterThanOrEqual(44)
      await expect(swatch.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    }
    await expect(colors.scrollWidth).toBeLessThanOrEqual(colors.clientWidth)
  },
}

export const NewBadge: Story = {
  args: { isNew: true },
  render: (args) => (
    <div style={{ width: "100%", maxWidth: 320 }}>
      <ProductCard {...args} />
    </div>
  ),
  play: async ({ canvas, canvasElement }) => {
    const link = canvas.getByRole("link", { name: "Artwork preview" })
    const artwork = canvas.getByAltText("Illustrative star artwork")
    const badge = canvas.getByText("New")
    if ("__vitest_browser__" in globalThis) {
      const { commands } = await import("vitest/browser")
      if ("resetMousePosition" in commands && typeof commands.resetMousePosition === "function") {
        await commands.resetMousePosition()
      }
    }
    await expect(badge).toBeVisible()
    // Out of the card's name: the link is still named by the heading alone.
    await expect(link).toHaveAccessibleName("Artwork preview")
    const media = badge.closest(".product-card-media")!.getBoundingClientRect()
    const box = badge.getBoundingClientRect()
    await expect(box.top - media.top).toBeCloseTo(8, 0)
    await expect(media.right - box.right).toBeCloseTo(8, 0)

    canvasElement.tabIndex = -1
    canvasElement.focus()
    await userEvent.tab()
    await expect(link).toHaveFocus()
    await waitFor(() => expect(artwork).toBeVisible())
    await expect(badge).toBeVisible()
    // pointer-events-none keeps the badge out of hit testing, so lift it just long enough to ask what
    // paints on top: the badge, not the artwork overlay that focus revealed.
    const center = badge.getBoundingClientRect()
    badge.style.pointerEvents = "auto"
    const topmost = document.elementFromPoint(center.left + center.width / 2, center.top + center.height / 2)
    badge.style.pointerEvents = ""
    await expect(topmost).toBe(badge)
  },
}

export const ArtworkPreview: Story = {
  play: async ({ canvas, canvasElement }) => {
    const link = canvas.getByRole("link", { name: "Artwork preview" })
    const artwork = canvas.getByAltText("Illustrative star artwork")
    const mockup = canvas.getByAltText("Illustrative shirt mockup")
    // Reset after rendering too: Linux Chromium can restore hover after Storybook's beforeEach reset.
    if ("__vitest_browser__" in globalThis) {
      const { commands } = await import("vitest/browser")
      if ("resetMousePosition" in commands && typeof commands.resetMousePosition === "function") {
        await commands.resetMousePosition()
      }
    }
    canvasElement.tabIndex = -1
    canvasElement.focus()
    await waitFor(() => {
      expect(mockup).toBeVisible()
      expect(artwork).not.toBeVisible()
    })
    await userEvent.tab()
    await expect(link).toHaveFocus()
    await waitFor(() => expect(artwork).toBeVisible())
    await expect(mockup).not.toBeVisible()
    await waitFor(() => expect((artwork as HTMLImageElement).naturalWidth).toBeGreaterThan(0))
    await expect(artwork.parentElement).toHaveStyle({ backgroundColor: "#222222" })
    await expect(getComputedStyle(artwork).mixBlendMode).toBe("normal")
    await expect(getComputedStyle(link).outlineStyle).not.toBe("none")
  },
}

export const TouchArtworkPreview: Story = {
  render: (args) => (
    <>
      <ProductCard {...args} />
      <button type="button" className="mt-6 rounded-sm border border-current px-4 py-2">
        Continue browsing
      </button>
    </>
  ),
  play: async ({ canvas, canvasElement }) => {
    const link = canvas.getByRole("link", { name: "Artwork preview" })
    const artwork = canvas.getByAltText("Illustrative star artwork")
    const mockup = canvas.getByAltText("Illustrative shirt mockup")
    const outside = canvas.getByRole("button", { name: "Continue browsing" })
    const touch = (target: Element, type: string, clientY = 100) =>
      fireEvent(
        target,
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerType: "touch",
          pointerId: 1,
          isPrimary: true,
          clientX: 100,
          clientY,
          detail: type === "click" ? 1 : 0,
        })
      )

    await userEvent.unhover(link)
    canvasElement.tabIndex = -1
    canvasElement.focus()
    touch(mockup, "pointerdown")
    await waitFor(() => {
      expect(link).toHaveAttribute("data-touch-preview", "true")
      expect(artwork).toBeVisible()
      expect(mockup).not.toBeVisible()
    })
    await expect(touch(mockup, "contextmenu")).toBe(false)
    touch(artwork, "pointermove", 180)
    touch(artwork, "pointercancel", 180)
    touch(artwork, "click", 180)
    await expect(artwork).toBeVisible()

    touch(outside, "pointerdown")
    touch(outside, "pointermove", 180)
    touch(outside, "pointercancel", 180)
    fireEvent.scroll(window)
    await expect(artwork).toBeVisible()

    await userEvent.click(outside)
    await waitFor(() => {
      expect(link).not.toHaveAttribute("data-touch-preview", "true")
      expect(mockup).toBeVisible()
      expect(artwork).not.toBeVisible()
    })
  },
}
