import type { OrderAttribution } from "@/features/attribution/order-attribution-schema"

import type { ShippingAddress } from "./shipping-address"

export type OrderItem = {
  productId: string
  variantId: number
  quantity: number
  unitAmount: number
  title: string
  variantLabel: string
  imageUrl?: string
  productFingerprint: string
}

export type CheckoutOrder = {
  // Frozen payment identity, independent of future brand/configuration changes.
  commerceIdentity: string
  requestId: string
  requestFingerprint: string
  expiresAt: number
  shopId: string
  items: OrderItem[]
  shippingMode: "flat_rate"
  shippingAddress?: ShippingAddress
  shippingAmount: number
  subtotal: number
  currency: "usd"
  attribution?: OrderAttribution
  // Freeze the window shown for this checkout; later policy edits never extend an existing order.
  shippingEstimate: { handlingBusinessDays: number; calendar: "us-federal-v1"; timeZone: string }
}

export type FulfillmentState = "pending" | "creating" | "created" | "submitting" | "submitted" | "simulated"

// A verified capture at checkout, not a live refund or dispute balance.
export type CheckoutPayment = {
  status: "paid"
  paymentIntentId: string
  paidAt: string
  livemode: boolean
  currency: "usd"
  subtotalAmount: number
  shippingAmount: number
  taxAmount: number
  totalAmount: number
  customerName: string | null
  customerEmail: string | null
}

export type StoredOrder = {
  order: CheckoutOrder
  payment: CheckoutPayment | null
  sessionId: string | null
  checkoutUrl: string | null
  state: FulfillmentState
  printifyOrderId: string | null
  failureCode: string | null
}

export type OrderStore = {
  withLock: <T>(
    requestId: string,
    callback: (record: {
      ensureCommerceIdentity: (identity: string) => Promise<void>
      get: () => Promise<StoredOrder | null>
      insert: (order: CheckoutOrder) => Promise<void>
      savePayment: (payment: CheckoutPayment) => Promise<void>
      saveShippingAddress: (address: ShippingAddress) => Promise<void>
      update: (
        patch: Partial<Pick<StoredOrder, "sessionId" | "checkoutUrl" | "state" | "printifyOrderId" | "failureCode">>
      ) => Promise<void>
    }) => Promise<T>
  ) => Promise<T>
  findBySession: (sessionId: string) => Promise<StoredOrder | null>
}
