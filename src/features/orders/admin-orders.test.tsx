import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { adminOrderFixtures } from "../../../test/admin-order-fixtures"

import { AdminOrders } from "./admin-orders"

const { filters: adminOrderFilters, order: adminOrderFixture } = adminOrderFixtures

describe("admin orders", () => {
  it("shows captured totals, attribution and a safe payment link", () => {
    render(
      <AdminOrders
        filters={adminOrderFilters}
        result={{ status: "ready", orders: [adminOrderFixture], hasNextPage: false }}
      />
    )
    expect(screen.getByText("$41.80")).toBeVisible()
    expect(screen.getByRole("link", { name: "Stripe (opens in a new tab)" })).toHaveAttribute(
      "href",
      "https://dashboard.stripe.com/payments"
    )
    expect(screen.getByText("Jamie Customer")).toBeVisible()
    expect(screen.getByText("Customer (billing)")).toBeVisible()
    fireEvent.click(screen.getByText("Order details", { selector: "summary" }))
    expect(screen.getByText("Delivery recipient")).toBeVisible()
    expect(screen.getByText("Robin Recipient")).toBeVisible()
    expect(screen.getByText("instagram")).toBeVisible()
    expect(screen.getByText("september_send")).toBeVisible()
    expect(within(screen.getByRole("list", { name: "Orders" })).getByText("Sent to Printify")).toBeVisible()
    expect(screen.getByRole("link", { name: "View in Stripe (opens in a new tab)", hidden: true })).toHaveAttribute(
      "href",
      "https://dashboard.stripe.com/payments/pi_orderfixture"
    )
  })

  it("never presents historical fulfillment as proof of payment or source", () => {
    render(
      <AdminOrders
        filters={{ ...adminOrderFilters, payment: "all" }}
        result={{
          status: "ready",
          orders: [
            {
              ...adminOrderFixture,
              paymentStatus: "unverified",
              customerName: null,
              totalAmount: null,
              paidAt: null,
              paymentIntentId: null,
              source: null,
              channel: "unknown",
              campaign: null,
              landingPath: null,
              referrerHost: null,
              attributionMethod: null,
            },
          ],
          hasNextPage: false,
        }}
      />
    )
    expect(screen.getByText("Payment not recorded")).toBeVisible()
    expect(screen.getByText("Recipient", { exact: true })).toBeVisible()
    expect(screen.getAllByText("Robin Recipient")[0]).toBeVisible()
    expect(screen.queryByText("Customer (billing)")).not.toBeInTheDocument()
    expect(screen.queryByText("Payment captured")).not.toBeInTheDocument()
    expect(screen.queryByText("$41.80")).not.toBeInTheDocument()
    expect(screen.queryByText("Direct", { selector: "span" })).not.toBeInTheDocument()
    expect(within(screen.getByRole("list", { name: "Orders" })).getByText("Sent to Printify")).toBeVisible()
  })

  it("labels test orders and preserves every filter when paging", () => {
    render(
      <AdminOrders
        filters={{ ...adminOrderFilters, page: 2, mode: "test", channel: "social" }}
        result={{
          status: "ready",
          orders: [{ ...adminOrderFixture, testOrder: true, fulfillmentState: "simulated" }],
          hasNextPage: true,
        }}
      />
    )
    expect(screen.getByText("Test order")).toBeVisible()
    expect(screen.getByRole("link", { name: "Stripe (opens in a new tab)" })).toHaveAttribute(
      "href",
      "https://dashboard.stripe.com/test/payments"
    )
    const navigation = within(screen.getByRole("navigation", { name: "Order pages" }))
    expect(navigation.getByRole("link", { name: "Previous page" })).toHaveAttribute(
      "href",
      "/admin/orders?payment=paid&fulfillment=all&channel=social&mode=test&page=1"
    )
    expect(navigation.getByRole("link", { name: "Next page" })).toHaveAttribute(
      "href",
      "/admin/orders?payment=paid&fulfillment=all&channel=social&mode=test&page=3"
    )
    expect(screen.getByRole("link", { name: "View in Stripe (opens in a new tab)", hidden: true })).toHaveAttribute(
      "href",
      "https://dashboard.stripe.com/test/payments/pi_orderfixture"
    )
  })

  it("distinguishes each order disclosure by its accessible name", () => {
    render(
      <AdminOrders
        filters={adminOrderFilters}
        result={{
          status: "ready",
          hasNextPage: false,
          orders: [adminOrderFixture, { ...adminOrderFixture, requestId: "22222222-2222-4222-8222-222222222222" }],
        }}
      />
    )
    const summaries = screen.getAllByText("Order details", { selector: "summary" })
    expect(summaries[0]).toHaveAccessibleName("Order details for ORDER-11111111")
    expect(summaries[1]).toHaveAccessibleName("Order details for ORDER-22222222")
  })

  it("makes an unavailable database distinct from an empty list", () => {
    render(<AdminOrders filters={adminOrderFilters} result={{ status: "unavailable" }} />)
    expect(screen.getByRole("alert")).toHaveTextContent("Orders are unavailable")
    expect(screen.queryByText("No orders match these filters")).not.toBeInTheDocument()
  })
})
