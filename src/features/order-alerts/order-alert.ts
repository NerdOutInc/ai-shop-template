import type { CheckoutOrder, CheckoutPayment, FulfillmentState } from "@/features/checkout/checkout-order"

export type AlertOrder = {
  request_id: string
  snapshot: CheckoutOrder
  payment: CheckoutPayment
  session_id: string | null
  printify_order_id: string | null
  state: FulfillmentState
  failure_code: string | null
}

export type ShipmentCheck = { complete: boolean; summary: string; items: string[]; needsAttention: boolean }
export type PaymentCheck = "paid" | "refunded" | "partial_refund" | "disputed" | "unknown"
export type OwnerEmail = { from: string; to: string[]; subject: string; text: string }
