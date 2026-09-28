import type { Meta, StoryObj } from "@storybook/nextjs-vite"
import { expect, userEvent } from "storybook/test"

import { storeConfig } from "@/lib/store-config"

import { BrandLogo } from "./brand-logo"

const meta = {
  title: "Store/Brand logo",
  component: BrandLogo,
  parameters: { layout: "fullscreen" },
  args: { name: storeConfig.name, logo: storeConfig.logo },
  decorators: [
    (Story, { args }) => (
      <header className="store-header">
        <div className="page-width header-inner">
          <a className="brand-link" href="#brand-preview" aria-label={`${args.name} home`}>
            <Story />
          </a>
          <nav className="store-nav" aria-label="Primary navigation">
            <a href="#about">About</a>
            <a href="#shop">Shop</a>
            <a href="#cart">Cart</a>
          </nav>
        </div>
      </header>
    ),
  ],
} satisfies Meta<typeof BrandLogo>
export default meta
type Story = StoryObj<typeof meta>

const verifyLayout: NonNullable<Story["play"]> = async ({ canvas, canvasElement, args }) => {
  const link = canvas.getByRole("link", { name: `${args.name} home` })
  link.focus()
  await userEvent.keyboard("{Tab}{Shift>}{Tab}{/Shift}")
  await expect(link).toHaveFocus()
  await expect(getComputedStyle(link).outlineStyle).not.toBe("none")
  const image = link.querySelector("img")!
  await expect(image).toBeVisible()
  await expect(image.getBoundingClientRect().right).toBeLessThanOrEqual(link.getBoundingClientRect().right + 1)
  await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  await expect(link).toHaveTextContent(args.logo?.showName ? args.name! : "")
}

export const MarkAndName: Story = { play: verifyLayout }
export const LargeSourceMark: Story = {
  args: { logo: { ...storeConfig.logo, width: 512, height: 512 } },
  play: async (context) => {
    await verifyLayout(context)
    const image = context.canvasElement.querySelector("img")!.getBoundingClientRect()
    await expect(image.width).toBeLessThanOrEqual(80)
    await expect(image.width / image.height).toBeCloseTo(1, 1)
  },
}
export const LongName: Story = {
  args: { name: "A Very Long Apparel Brand With Many Excellent Words And Good Shirts" },
  play: verifyLayout,
}
export const Wordmark: Story = {
  args: {
    logo: {
      src: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="48" viewBox="0 0 240 48"><rect width="240" height="48" fill="#ffffff"/><text x="120" y="33" text-anchor="middle" font-family="Arial" font-size="28" fill="#25364d">FIXTURE STORE</text></svg>')}`,
      width: 240,
      height: 48,
      showName: false,
    },
  },
  play: async (context) => {
    await verifyLayout(context)
    const image = context.canvasElement.querySelector("img")!.getBoundingClientRect()
    await expect(image.width / image.height).toBeCloseTo(5, 1)
  },
}
