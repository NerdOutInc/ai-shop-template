import type { Meta, StoryObj } from "@storybook/nextjs-vite"
import { expect, within } from "storybook/test"

import { adminOrderFixtures } from "../../../test/admin-order-fixtures"

import { AdminOrders } from "./admin-orders"

const { filters: adminOrderFilters, order: adminOrderFixture } = adminOrderFixtures

const meta = {
  title: "Admin/Orders",
  component: AdminOrders,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <main className="page-width py-10">
        <h1 className="display-heading mb-8">Orders</h1>
        <Story />
      </main>
    ),
  ],
  args: { filters: adminOrderFilters, result: { status: "ready", orders: [adminOrderFixture], hasNextPage: true } },
} satisfies Meta<typeof AdminOrders>

export default meta
type Story = StoryObj<typeof meta>

export const CapturedOrders: Story = {
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByText("$41.80")).toBeVisible()
    const payment = canvas.getByLabelText("Payment", { exact: true })
    payment.focus()
    await expect(payment).toHaveFocus()
    await userEvent.selectOptions(payment, "all")
    await expect(payment).toHaveValue("all")
    await userEvent.tab()
    await expect(canvas.getByLabelText("Fulfillment", { exact: true })).toHaveFocus()
    const details = canvas.getByText("Order details", { selector: "summary" })
    await expect(details).toHaveAccessibleName("Order details for ORDER-11111111")
    await userEvent.click(details)
    await expect(canvas.getByText("instagram.com")).toBeVisible()
    await expect(canvas.getByText("Customer (billing)")).toBeVisible()
    await expect(canvas.getByText("Delivery recipient")).toBeVisible()
    await expect(canvas.getByText("Robin Recipient")).toBeVisible()
    await expect(canvas.getByRole("link", { name: "View in Stripe (opens in a new tab)" })).toBeVisible()
    await expect(details).toHaveFocus()
  },
}

export const UnknownHistoricalSource: Story = {
  args: {
    filters: { ...adminOrderFilters, payment: "all" },
    result: {
      status: "ready",
      hasNextPage: false,
      orders: [
        {
          ...adminOrderFixture,
          source: null,
          channel: "unknown",
          campaign: null,
          landingPath: null,
          attributionMethod: null,
          referrerHost: null,
          paidAt: null,
          paymentIntentId: null,
          paymentStatus: "unverified",
          customerName: null,
          totalAmount: null,
        },
      ],
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Payment not recorded")).toBeVisible()
    await expect(canvas.getByText("Recipient", { exact: true })).toBeVisible()
    await expect(
      within(canvas.getByRole("list", { name: "Orders" })).queryByText("Payment captured")
    ).not.toBeInTheDocument()
  },
}

export const NeedsAttention: Story = {
  args: {
    result: {
      status: "ready",
      hasNextPage: false,
      orders: [
        {
          ...adminOrderFixture,
          fulfillmentState: "pending",
          failureCode: "PRINTIFY_UNAVAILABLE",
          printifyOrderId: null,
        },
      ],
    },
  },
}

export const TestOrder: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("link", { name: "Stripe (opens in a new tab)" })).toHaveAttribute(
      "href",
      "https://dashboard.stripe.com/test/payments"
    )
  },
  args: {
    filters: { ...adminOrderFilters, mode: "test" },
    result: {
      status: "ready",
      hasNextPage: false,
      orders: [{ ...adminOrderFixture, testOrder: true, fulfillmentState: "simulated", printifyOrderId: null }],
    },
  },
}

export const Empty: Story = { args: { result: { status: "ready", orders: [], hasNextPage: false } } }
export const Unavailable: Story = { args: { result: { status: "unavailable" } } }
