import "server-only"

import { z } from "zod"

import { CheckoutError } from "./checkout-error"
import type { CheckoutOrder } from "./checkout-order"
import type { PrintifyClient } from "./printify-client.server"

const orderSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  metadata: z.object({ shop_order_id: z.union([z.string(), z.number()]) }),
  line_items: z.array(
    z.object({
      product_id: z.string(),
      variant_id: z.number().int(),
      quantity: z.number().int(),
      status: z.string().optional(),
    })
  ),
  address_to: z.object({
    first_name: z.string(),
    last_name: z.string(),
    email: z.string(),
    phone: z.string().optional(),
    country: z.string(),
    region: z.string(),
    address1: z.string(),
    address2: z.string().optional().default(""),
    city: z.string(),
    zip: z.string(),
  }),
})

export async function readPrintifyOrder(
  client: PrintifyClient,
  sessionId: string,
  order: CheckoutOrder,
  orderId?: string
) {
  const address = order.shippingAddress
  if (!address)
    throw new CheckoutError("SHIPPING_ADDRESS_INVALID", "Your delivery details need our attention before printing.")
  let raw: unknown
  if (orderId) {
    raw = await client.request(`orders/${encodeURIComponent(orderId)}.json`)
  } else {
    // Recovery scans are read-only. Replaying an ambiguous create is never safe without provider idempotency.
    const seen = new Set<string>()
    const matches: unknown[] = []
    for (let page = 1; page <= 100; page++) {
      const parsed = z
        .object({
          current_page: z.number().int(),
          last_page: z.number().int().optional(),
          data: z.array(
            z
              .object({
                id: z.string(),
                metadata: z.object({ shop_order_id: z.union([z.string(), z.number()]).optional() }).optional(),
              })
              .passthrough()
          ),
        })
        .safeParse(await client.request(`orders.json?limit=10&page=${page}`))
      if (!parsed.success || parsed.data.current_page !== page)
        throw new CheckoutError(
          "ORDER_RECONCILIATION_FAILED",
          "Your payment is safe, but your order needs our attention."
        )
      for (const item of parsed.data.data) {
        if (seen.has(item.id)) continue
        seen.add(item.id)
        if (String(item.metadata?.shop_order_id) === sessionId) matches.push(item)
      }
      const finished =
        parsed.data.last_page !== undefined ? page >= parsed.data.last_page : parsed.data.data.length < 10
      if (finished) {
        if (matches.length > 1) throw new CheckoutError("DUPLICATE_PROVIDER_ORDER", "Your order needs our attention.")
        raw = matches[0]
        break
      }
      if (page === 100) throw new CheckoutError("ORDER_RECONCILIATION_FAILED", "Your order needs our attention.")
    }
    if (!raw) return null
  }
  const parsed = orderSchema.safeParse(raw)
  if (
    !parsed.success ||
    (orderId && parsed.data.id !== orderId) ||
    String(parsed.data.metadata.shop_order_id) !== sessionId
  ) {
    throw new CheckoutError("ORDER_MISMATCH", "Your order needs our attention.")
  }
  const actual = parsed.data
  const key = (item: { productId: string; variantId: number; quantity: number }) =>
    `${item.productId}:${item.variantId}:${item.quantity}`
  const expectedItems = order.items.map(key).sort()
  const actualItems = actual.line_items
    .map((item) => key({ productId: item.product_id, variantId: item.variant_id, quantity: item.quantity }))
    .sort()
  const destination = actual.address_to
  const normalized = (value: string) => value.trim().normalize("NFKC").toLowerCase()
  const phoneDigits = (value: string) => value.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "")
  if (
    JSON.stringify(expectedItems) !== JSON.stringify(actualItems) ||
    normalized(destination.first_name) !== normalized(address.firstName) ||
    normalized(destination.last_name) !== normalized(address.lastName) ||
    normalized(destination.email) !== normalized(address.email) ||
    (destination.phone !== undefined && phoneDigits(destination.phone) !== phoneDigits(address.phone)) ||
    !["US", "United States"].includes(destination.country) ||
    destination.region !== address.region ||
    destination.address1 !== address.address1 ||
    destination.address2 !== address.address2 ||
    destination.city !== address.city ||
    destination.zip !== address.zip
  ) {
    throw new CheckoutError("ORDER_MISMATCH", "Your order needs our attention.")
  }
  return actual
}
