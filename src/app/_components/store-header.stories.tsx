import type { Meta, StoryObj } from "@storybook/nextjs-vite"
import type { CSSProperties } from "react"
import { expect, userEvent } from "storybook/test"

import { CartProvider } from "@/features/cart/cart-provider"
import { useCart } from "@/features/cart/use-cart"
import { storeConfig } from "@/lib/store-config"

import { StoreHeader } from "./store-header"

function AddSampleShirt() {
  const { addItem } = useCart()
  return (
    <button
      className="button m-4"
      type="button"
      onClick={() =>
        addItem({
          productId: "111111000000000000000002",
          variantId: 1,
          title: "Header story shirt",
          variantTitle: "Black / M",
          unitAmount: 2500,
          quantity: 2,
        })
      }
    >
      Add sample shirts
    </button>
  )
}

const meta = {
  title: "Store/Header",
  component: StoreHeader,
  parameters: {
    layout: "fullscreen",
    nextjs: { appDirectory: true, navigation: { pathname: "/shop", segments: ["shop"] } },
    palette: { accent: "#1e3a8a", accentForeground: "#ffffff" },
  },
  beforeEach: () => {
    const storedCart = localStorage.getItem("your-store-cart-v1")
    localStorage.removeItem("your-store-cart-v1")
    return () => {
      if (storedCart === null) localStorage.removeItem("your-store-cart-v1")
      else localStorage.setItem("your-store-cart-v1", storedCart)
    }
  },
  decorators: [
    (Story, { parameters }) => (
      <div
        style={
          {
            "--primary": storeConfig.theme.primary,
            "--primary-foreground": storeConfig.theme.primaryForeground,
            "--foreground": storeConfig.theme.foreground,
            "--accent": parameters.palette.accent,
            "--accent-foreground": parameters.palette.accentForeground,
          } as CSSProperties
        }
      >
        <CartProvider>
          <Story />
          <main>
            <AddSampleShirt />
          </main>
        </CartProvider>
      </div>
    ),
  ],
} satisfies Meta<typeof StoreHeader>
export default meta
type Story = StoryObj<typeof meta>

const verifyHeader: NonNullable<Story["play"]> = async ({ canvas, canvasElement, parameters }) => {
  const shop = canvas.getByRole("link", { name: /^Shop$/ })
  await expect(shop).toHaveAttribute("aria-current", "page")
  const activeBar = getComputedStyle(shop, "::after")
  await expect(activeBar.backgroundColor).toBe("rgb(255, 255, 255)")
  await expect(activeBar.content).not.toBe("none")
  await expect(activeBar.content).not.toBe("normal")
  await expect(Number.parseFloat(activeBar.width)).toBeGreaterThan(0)
  await expect(Number.parseFloat(activeBar.height)).toBeGreaterThan(0)
  await expect(getComputedStyle(canvas.getByRole("banner")).backgroundColor).toBe("rgb(37, 54, 77)")

  const home = canvas.getByRole("link", { name: `${storeConfig.name} home` })
  home.focus()
  await userEvent.tab()
  if (storeConfig.features.about) await userEvent.tab()
  await expect(shop).toHaveFocus()
  await expect(getComputedStyle(shop).outlineStyle).toBe("solid")
  await expect(Number.parseFloat(getComputedStyle(shop).outlineWidth)).toBeGreaterThan(0)
  await expect(getComputedStyle(shop).outlineColor).toBe("rgb(255, 255, 255)")

  await userEvent.click(canvas.getByRole("button", { name: "Add sample shirts" }))
  const cart = canvas.getByRole("link", { name: "Cart, 2 items" })
  const count = cart.querySelector(".cart-count")!
  await expect(count).toHaveTextContent("2")
  await expect(count).toBeVisible()
  const colorProbe = canvasElement.ownerDocument.createElement("span")
  colorProbe.style.color = parameters.palette.accentForeground
  colorProbe.style.backgroundColor = parameters.palette.accent
  canvasElement.append(colorProbe)
  const expectedColors = getComputedStyle(colorProbe)
  await expect(getComputedStyle(count).color).toBe(expectedColors.color)
  await expect(getComputedStyle(count).backgroundColor).toBe(expectedColors.backgroundColor)
  colorProbe.remove()
  shop.focus()
  await userEvent.tab()
  await expect(cart).toHaveFocus()
  await expect(getComputedStyle(cart).outlineStyle).toBe("solid")
  await expect(Number.parseFloat(getComputedStyle(cart).outlineWidth)).toBeGreaterThan(0)
  await expect(getComputedStyle(cart).outlineColor).toBe("rgb(255, 255, 255)")
  await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
}

export const DarkAccent: Story = { play: verifyHeader }
export const LightAccent: Story = {
  parameters: { palette: { accent: "#dbe8fa", accentForeground: "#18202b" } },
  play: verifyHeader,
}
