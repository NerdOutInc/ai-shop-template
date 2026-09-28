import type { Meta, StoryObj } from "@storybook/nextjs-vite"
import { expect, within } from "storybook/test"

import { NewProductBadge } from "./new-product-badge"

function IllustrativeShirt() {
  return (
    <svg viewBox="0 0 800 800" aria-hidden="true" className="h-full w-full">
      <path d="M270 180 160 260 230 370 280 340V620H520V340L570 370 640 260 530 180 460 210H340Z" fill="#595959" />
    </svg>
  )
}

const meta = {
  title: "Catalog/New product badge",
  component: NewProductBadge,
  parameters: { layout: "padded" },
} satisfies Meta<typeof NewProductBadge>
export default meta
type Story = StoryObj<typeof meta>

/** A shop card image, and the product page gallery frame, which is the same idea at a larger size. */
export const Default: Story = {
  args: { size: "default" },
  render: (args) => (
    <div
      data-testid="shop-card-image"
      className="relative flex aspect-square w-80 max-w-full items-center justify-center overflow-hidden bg-[#ededed]"
    >
      <IllustrativeShirt />
      <NewProductBadge {...args} />
    </div>
  ),
  play: async ({ canvas }) => {
    await document.fonts.ready
    const badge = canvas.getByText("New")
    await expect(badge).toBeVisible()
    const frame = canvas.getByTestId("shop-card-image").getBoundingClientRect()
    const box = badge.getBoundingClientRect()
    // Tucked into the top-right corner, clear of the shirt in the middle.
    await expect(box.top - frame.top).toBeCloseTo(8, 0)
    await expect(frame.right - box.right).toBeCloseTo(8, 0)
    await expect(box.width).toBeLessThan(frame.width / 4)
    // A touch on the tag is a touch on the image under it.
    await expect(getComputedStyle(badge).pointerEvents).toBe("none")
  },
}

/**
 * The admin lineup's thumbnail, where the shop size would cover the shirt: 64px from the small
 * breakpoint up and 56px below it, so the tag has to fit both.
 */
export const Compact: Story = {
  args: { size: "compact" },
  render: (args) => (
    <div className="flex items-start gap-4">
      {[64, 56].map((size) => (
        <div
          key={size}
          data-testid="admin-thumbnail"
          style={{ width: size, height: size }}
          className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted"
        >
          <IllustrativeShirt />
          <NewProductBadge {...args} />
        </div>
      ))}
    </div>
  ),
  play: async ({ canvas }) => {
    await document.fonts.ready
    const thumbnails = canvas.getAllByTestId("admin-thumbnail")
    await expect(thumbnails.map((thumbnail) => thumbnail.getBoundingClientRect().width)).toEqual([64, 56])
    for (const thumbnail of thumbnails) {
      const frame = thumbnail.getBoundingClientRect()
      const badge = within(thumbnail).getByText("New")
      const box = badge.getBoundingClientRect()
      await expect(badge).toBeVisible()
      // Whole, inside the rounded thumbnail that clips anything hanging over its edge.
      await expect(box.top).toBeGreaterThanOrEqual(frame.top)
      await expect(box.right).toBeLessThanOrEqual(frame.right)
      await expect(box.bottom).toBeLessThanOrEqual(frame.bottom)
      await expect(box.left).toBeGreaterThanOrEqual(frame.left)
      await expect(badge.scrollWidth).toBeLessThanOrEqual(badge.clientWidth)
      // A corner tag: it leaves most of the shirt showing.
      await expect(box.width * box.height).toBeLessThan((frame.width * frame.height) / 4)
      await expect(box.height).toBeLessThan(frame.height / 3)
    }
  },
}
