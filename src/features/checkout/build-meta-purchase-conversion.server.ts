import "server-only"

import { buildMetaStandardEvent } from "@/features/analytics/build-meta-standard-event"
import type { MetaPurchaseConversion } from "@/features/analytics/meta-standard-event"
import type { PurchaseConversion } from "@/features/analytics/purchase-conversion"

import type { StoredOrder } from "./checkout-order"

/** Enrich the same order's buildPurchaseConversion result without repeating payment verification. */
export function buildMetaPurchaseConversion(
  purchase: PurchaseConversion | null,
  stored: StoredOrder
): MetaPurchaseConversion | null {
  if (!purchase) return null
  const candidate = { ...purchase, items: stored.order.items }
  if (!buildMetaStandardEvent({ name: "Purchase", purchase: candidate })) return null
  const subtotal = candidate.items.reduce((sum, item) => sum + item.quantity * item.unitAmount, 0)
  if (subtotal !== stored.order.subtotal) return null

  return {
    receipt: purchase.receipt,
    totalUsd: purchase.totalUsd,
    // Stored orders can contain delivery details and provider references.
    // Copy only catalog identity, quantity, and price into the browser contract.
    items: candidate.items.map(({ productId, variantId, quantity, unitAmount }) => ({
      productId,
      variantId,
      quantity,
      unitAmount,
    })),
  }
}
