import type { Meta, StoryObj } from "@storybook/nextjs-vite"
import { expect } from "storybook/test"

import { CartProvider } from "./cart-provider"
import { CheckoutStatus } from "./checkout-status"

const meta = {
  title: "Cart/Order status",
  component: CheckoutStatus,
  parameters: { layout: "padded" },
  args: { sessionId: "cs_test_story1234567890" },
  decorators: [
    (Story) => (
      <CartProvider>
        <main className="py-10">
          <Story />
        </main>
      </CartProvider>
    ),
  ],
} satisfies Meta<typeof CheckoutStatus>

export default meta
type Story = StoryObj<typeof meta>

export const PaymentConfirmed: Story = {
  beforeEach: () => {
    const original = globalThis.fetch
    globalThis.fetch = async () => Response.json({ paymentStatus: "paid", fulfillmentStatus: "submitted" })
    return () => {
      globalThis.fetch = original
    }
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("heading", { name: "Your order is confirmed." })).toBeVisible()
    await expect(canvas.getByRole("status")).toHaveTextContent("your order is with our printing partner")
  },
}

export const TestPayment: Story = {
  beforeEach: () => {
    const original = globalThis.fetch
    globalThis.fetch = async () => Response.json({ paymentStatus: "paid", fulfillmentStatus: "simulated" })
    return () => {
      globalThis.fetch = original
    }
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText(/No real order was sent for printing/)).toBeVisible()
  },
}

export const RetryStatus: Story = {
  beforeEach: () => {
    const original = globalThis.fetch
    let calls = 0
    globalThis.fetch = async () => {
      if (++calls === 1) throw new Error("Story connection failure")
      return Response.json({ paymentStatus: "paid", fulfillmentStatus: "submitted" })
    }
    return () => {
      globalThis.fetch = original
    }
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Check order status" }))
    await expect(await canvas.findByRole("heading", { name: "Your order is confirmed." })).toBeVisible()
  },
}

export const MissingCheckout: Story = {
  args: { sessionId: null },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("heading", { name: "Let’s find your checkout." })).toBeVisible()
    await expect(canvas.getByRole("link", { name: "Back to your cart" })).toBeVisible()
  },
}
