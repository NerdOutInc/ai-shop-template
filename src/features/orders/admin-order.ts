import type { FulfillmentState } from "@/features/checkout/checkout-order"
import type { OrderAttribution } from "@/features/attribution/order-attribution-schema"

export type OrderChannel = OrderAttribution["channel"] | "unknown"

export type AdminOrder = {
  requestId: string
  createdAt: string
  customerName: string | null
  customerEmail: string | null
  recipientName: string | null
  totalAmount: number | null
  currency: string
  paidAt: string | null
  paymentIntentId: string | null
  paymentStatus: "paid" | "unverified"
  testOrder: boolean
  fulfillmentState: FulfillmentState
  failureCode: string | null
  printifyOrderId: string | null
  source: string | null
  referrerHost: string | null
  channel: OrderChannel
  campaign: string | null
  landingPath: string | null
  attributionMethod: string | null
}

export type AdminOrderFilters = {
  orderId?: string
  page: number
  payment: "paid" | "unverified" | "all"
  fulfillment: "all" | "pending" | "attention" | "submitted"
  channel: OrderChannel | "all"
  mode: "live" | "test" | "all"
}

export type AdminOrderListResult =
  { status: "ready"; orders: AdminOrder[]; hasNextPage: boolean } | { status: "unavailable" }
