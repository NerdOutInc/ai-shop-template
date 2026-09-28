import type { AdminOrder, AdminOrderFilters } from "@/features/orders/admin-order"

const filters: AdminOrderFilters = {
  page: 1,
  payment: "paid",
  fulfillment: "all",
  channel: "all",
  mode: "live",
}

const order: AdminOrder = {
  requestId: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-09-21T18:20:00.000Z",
  customerName: "Jamie Customer",
  customerEmail: "jamie@example.test",
  recipientName: "Robin Recipient",
  totalAmount: 4180,
  currency: "usd",
  paidAt: "2026-09-21T18:22:00.000Z",
  paymentIntentId: "pi_orderfixture",
  paymentStatus: "paid",
  testOrder: false,
  fulfillmentState: "submitted",
  failureCode: null,
  printifyOrderId: "printify-order-fixture",
  source: "instagram",
  referrerHost: "instagram.com",
  channel: "social",
  campaign: "september_send",
  landingPath: "/shop/send-it",
  attributionMethod: "campaign",
}

export const adminOrderFixtures = { filters, order }
