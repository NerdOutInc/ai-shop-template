import type { Meta, StoryObj } from "@storybook/nextjs-vite"
import { expect, fn, userEvent, waitFor } from "storybook/test"

import { ProductImageGallery } from "./product-image-gallery"

const sampleMockup = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#ffffff"/><path d="M270 180 160 260 230 370 280 340V620H520V340L570 370 640 260 530 180 460 210H340Z" fill="#222222"/><text x="400" y="710" text-anchor="middle" font-family="sans-serif" font-size="24">Illustrative provider mockup</text></svg>')}`
// A neutral stand-in for an owner-supplied photograph: it carries its own scene, unlike a mockup.
const sampleStorePhoto = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#6f8f9c"/><rect y="560" width="800" height="240" fill="#b48a62"/><path d="M270 180 160 260 230 370 280 340V620H520V340L570 370 640 260 530 180 460 210H340Z" fill="#222222"/><text x="400" y="710" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#ffffff">Illustrative store photo</text></svg>')}`

const meta = {
  title: "Catalog/Product image gallery",
  component: ProductImageGallery,
  args: {
    title: "Sample tee",
    images: [
      { src: sampleMockup, alt: "Sample tee provider mockup" },
      { src: sampleStorePhoto, alt: "Sample tee photographed on a table", origin: "store" },
    ],
    artwork: null,
    placeholder: "No photo yet",
    onSlideSelect: fn(),
  },
  decorators: [
    (Story) => (
      <div style={{ width: "min(560px, calc(100vw - 32px))" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ProductImageGallery>
export default meta
type Story = StoryObj<typeof meta>

export const MixedProviderAndStorePhotos: Story = {
  play: async ({ canvas, canvasElement }) => {
    const mockup = canvas.getByRole("img", { name: "Sample tee provider mockup" })
    const thumbnails = canvasElement.querySelectorAll<HTMLImageElement>(".product-thumbnail img")
    // Mockups multiply onto the page; photographs already include their scene and stay unblended.
    await expect(getComputedStyle(mockup).mixBlendMode).toBe("multiply")
    await expect(getComputedStyle(thumbnails[0]!).mixBlendMode).toBe("multiply")
    await expect(getComputedStyle(thumbnails[1]!).mixBlendMode).toBe("normal")

    const second = canvas.getByRole("button", { name: "View photo 2 of Sample tee" })
    second.focus()
    await expect(getComputedStyle(second).outlineStyle).not.toBe("none")
    await userEvent.keyboard("{Enter}")
    await waitFor(() => expect(second).toHaveAttribute("aria-pressed", "true"))
    const photo = canvas.getByRole("img", { name: "Sample tee photographed on a table" })
    await expect(photo).toBeVisible()
    await expect(photo).toHaveAttribute("data-photo-origin", "store")
    await expect(getComputedStyle(photo).mixBlendMode).toBe("normal")
  },
}
