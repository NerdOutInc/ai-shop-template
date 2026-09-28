import "server-only"

import { createHash } from "node:crypto"

import { buildGooglePurchaseEvent } from "@/features/analytics/build-google-purchase-event"
import type { PurchaseConversion } from "@/features/analytics/purchase-conversion"

import type { StoredOrder } from "./checkout-order"

/** Enrich this order's verified payment without making another Stripe request. */
export function buildGooglePurchaseConversion(purchase: PurchaseConversion | null, stored: StoredOrder) {
  if (!purchase || !stored.sessionId) return null
  const { order } = stored
  const tax = Math.round(purchase.totalUsd * 100) - order.subtotal - order.shippingAmount
  return buildGooglePurchaseEvent({
    // A destination-specific identifier limits duplicates without disclosing the checkout capability or local receipt.
    transaction_id: createHash("sha256").update(`google-merchant:${stored.sessionId}`).digest("hex"),
    currency: "USD",
    value: order.subtotal / 100,
    shipping: order.shippingAmount / 100,
    tax: tax / 100,
    items: order.items.map(({ productId, variantId, quantity, unitAmount }) => ({
      item_id: `${productId}-${variantId}`,
      price: unitAmount / 100,
      quantity,
    })),
  })
}
