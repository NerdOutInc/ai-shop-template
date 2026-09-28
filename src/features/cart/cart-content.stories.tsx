import { configuredStoreConfig } from "../../../test/configured-store-config"
import type { Meta, StoryObj } from "@storybook/nextjs-vite"
import { expect } from "storybook/test"

import { storeConfig } from "@/lib/store-config"

import { CartContent } from "./cart-content"
import { CartProvider } from "./cart-provider"

const cart = {
  version: 1,
  entries: [
    {
      entryId: "story-shirt",
      productId: "aaaaaaaaaaaaaaaaaaaaaaaa",
      variantId: 1,
      title: "We just hang together",
      variantTitle: "Forest Green / M",
      unitAmount: 2800,
      quantity: 1,
    },
  ],
  checkouts: {},
}

const meta = {
  title: "Cart/Bag",
  component: CartContent,
  parameters: { layout: "padded" },
  args: { cancelled: false },
  decorators: [
    (Story) => (
      <CartProvider>
        <main className="mx-auto max-w-6xl p-3">
          <h1 className="display-heading mb-10 text-5xl">Your cart.</h1>
          <Story />
        </main>
      </CartProvider>
    ),
  ],
  beforeEach: () => {
    const previousStore = structuredClone(storeConfig)
    Object.assign(storeConfig, structuredClone(configuredStoreConfig))
    const previous = window.localStorage.getItem("your-store-cart-v1")
    window.localStorage.setItem("your-store-cart-v1", JSON.stringify(cart))
    return () => {
      Object.assign(storeConfig, previousStore)
      if (previous === null) window.localStorage.removeItem("your-store-cart-v1")
      else window.localStorage.setItem("your-store-cart-v1", previous)
    }
  },
} satisfies Meta<typeof CartContent>

export default meta
type Story = StoryObj<typeof meta>

export const Populated: Story = {
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByRole("heading", { name: "The good stuff (1)" })).toBeVisible()
    await expect(canvas.getByText("$4.95", { selector: "dd", exact: true })).toBeVisible()
    await expect(canvas.getByText("$32.95", { selector: "dd", exact: true })).toBeVisible()
    await expect(canvas.queryByRole("textbox")).not.toBeInTheDocument()
    await expect(canvas.getByRole("button", { name: "Checkout" })).toBeEnabled()
    await userEvent.click(canvas.getByRole("button", { name: /Increase quantity/ }))
    await expect(canvas.getByRole("heading", { name: "The good stuff (2)" })).toBeVisible()
    await expect(canvas.getByText("$56.00", { selector: "dd", exact: true })).toBeVisible()
    await expect(canvas.getByText("$7.35", { selector: "dd", exact: true })).toBeVisible()
    await expect(canvas.getByText("$63.35", { selector: "dd", exact: true })).toBeVisible()
    await userEvent.click(canvas.getByRole("button", { name: /Decrease quantity/ }))
    await expect(canvas.getByRole("heading", { name: "The good stuff (1)" })).toBeVisible()
    await userEvent.click(canvas.getByRole("button", { name: /Remove We just hang together/ }))
    await expect(canvas.getByRole("heading", { name: "Ready for your next favorite." })).toBeVisible()
  },
}

export const Empty: Story = {
  beforeEach: () => window.localStorage.removeItem("your-store-cart-v1"),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("link", { name: "Find your shirt" })).toBeVisible()
    await expect(canvas.queryByRole("button", { name: "Checkout" })).not.toBeInTheDocument()
  },
}

export const ReturnFromCheckout: Story = {
  args: { cancelled: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status")).toHaveTextContent("Your cart is still here")
    await expect(canvas.getByRole("heading", { name: "The good stuff (1)" })).toBeVisible()
  },
}

export const QuantityLimit: Story = {
  beforeEach: () =>
    window.localStorage.setItem(
      "your-store-cart-v1",
      JSON.stringify({ ...cart, entries: cart.entries.map((entry) => ({ ...entry, quantity: 10 })) })
    ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: /Increase quantity/ })).toBeDisabled()
    await expect(canvas.getByRole("button", { name: /Decrease quantity/ })).toBeEnabled()
  },
}

export const BeforeLaunch: Story = {
  beforeEach: () => {
    storeConfig.configured = false
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status")).toHaveTextContent("preparing checkout")
    await expect(canvas.getByRole("button", { name: "Checkout unavailable" })).toBeDisabled()
    await expect(canvas.queryByText("US shipping")).not.toBeInTheDocument()
  },
}
