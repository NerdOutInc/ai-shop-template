import "server-only"

import { z } from "zod"
import type { PrintifyClient } from "@/features/checkout/printify-client.server"
import type { AlertOrder, ShipmentCheck } from "./order-alert"

const schema = z.object({
  id: z.string(),
  metadata: z.object({ shop_order_id: z.union([z.string(), z.number()]) }),
  line_items: z
    .array(
      z.object({
        external_id: z.string().nullable().optional(),
        product_id: z.string(),
        variant_id: z.number().int(),
        quantity: z.number().int().positive(),
        status: z.string(),
      })
    )
    .min(1),
})

export async function readOrderShipment(
  client: Pick<PrintifyClient, "request">,
  order: AlertOrder
): Promise<ShipmentCheck> {
  const unknown: ShipmentCheck = {
    complete: false,
    summary: "Shipment could not be verified. Check Printify before contacting the customer.",
    items: [],
    needsAttention: true,
  }
  if (!order.printify_order_id)
    return { ...unknown, summary: "No Printify order is recorded. Check payment and fulfillment immediately." }
  try {
    const parsed = schema.safeParse(await client.request(`orders/${encodeURIComponent(order.printify_order_id)}.json`))
    if (
      !parsed.success ||
      !order.session_id ||
      parsed.data.id !== order.printify_order_id ||
      String(parsed.data.metadata.shop_order_id) !== order.session_id
    )
      return unknown
    const remaining = [...parsed.data.line_items]
    const items: string[] = []
    let shipped = 0
    let needsAttention = false
    for (const [index, item] of order.snapshot.items.entries()) {
      // Choice routing can change product/variant IDs; our external line ID survives routing.
      const matches = remaining.filter((line) =>
        line.external_id
          ? line.external_id === `${order.session_id}-${index}`
          : line.product_id === item.productId && line.variant_id === item.variantId
      )
      const line = matches[0]
      if (matches.length !== 1 || !line || line.quantity !== item.quantity) return unknown
      remaining.splice(remaining.indexOf(line), 1)
      const fulfilled = line.status === "fulfilled"
      if (fulfilled) shipped++
      if (["has_issues", "canceled", "on-hold"].includes(line.status)) needsAttention = true
      items.push(
        `${item.quantity} × ${item.title} (${item.variantLabel}): ${fulfilled ? "shipped" : "not confirmed shipped"}`
      )
    }
    if (remaining.length || !items.length) return unknown
    return {
      complete: shipped === items.length,
      needsAttention,
      items,
      summary: `${shipped} of ${items.length} order lines reported shipped by Printify.`,
    }
  } catch {
    return unknown
  }
}
