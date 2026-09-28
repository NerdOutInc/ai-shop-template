import "server-only"

import { z } from "zod"

const pageSchema = z.object({
  current_page: z.number().int().positive(),
  last_page: z.number().int().nonnegative().optional(),
  total: z.number().int().nonnegative().optional(),
  next_page_url: z.string().nullable().optional(),
  data: z.array(
    z.object({
      id: z.string().min(1),
      status: z.string(),
      metadata: z.object({ is_reprint: z.boolean().optional(), order_type: z.string().optional() }).optional(),
      line_items: z.array(
        z.object({
          product_id: z.string().min(1),
          quantity: z.number().int().positive(),
          status: z.string(),
        })
      ),
    })
  ),
})

const productionStatuses = new Set(["in-production", "fulfilled", "partially-fulfilled"])

export async function fetchCatalogPopularity(apiToken: string, shopId: string, selectedIds: readonly string[]) {
  const counts = new Map(selectedIds.map((id) => [id, 0]))
  const seenOrders = new Set<string>()
  const signal = AbortSignal.timeout(30_000)
  let expectedTotal: number | undefined
  // Larger histories need incremental reconciliation. Never call a bounded prefix complete history.
  for (let page = 1; page <= 200; page += 1) {
    const response = await fetch(`https://api.printify.com/v1/shops/${shopId}/orders.json?limit=10&page=${page}`, {
      headers: { Authorization: `Bearer ${apiToken}`, "User-Agent": "Clothing-Store/0.1", Accept: "application/json" },
      cache: "no-store",
      signal,
      redirect: "error",
    })
    if (!response.ok) throw new Error(`Printify popularity unavailable (HTTP ${response.status})`)
    const result = pageSchema.safeParse(await response.json())
    if (!result.success || result.data.current_page !== page) throw new Error("Invalid Printify order page")
    const data = result.data
    if (expectedTotal !== undefined && data.total !== undefined && expectedTotal !== data.total) {
      throw new Error("Printify order history changed during pagination")
    }
    expectedTotal ??= data.total
    for (const order of data.data) {
      if (seenOrders.has(order.id)) continue
      seenOrders.add(order.id)
      if (
        !productionStatuses.has(order.status) ||
        order.status === "canceled" ||
        order.status === "cancelled" ||
        order.metadata?.is_reprint ||
        order.metadata?.order_type === "sample"
      )
        continue
      for (const item of order.line_items) {
        if (productionStatuses.has(item.status)) {
          counts.set(item.product_id, (counts.get(item.product_id) ?? 0) + item.quantity)
        }
      }
    }
    const complete =
      data.last_page !== undefined
        ? page >= data.last_page
        : data.next_page_url !== undefined
          ? data.next_page_url === null
          : data.data.length < 10
    if (complete) {
      if (expectedTotal !== undefined && seenOrders.size !== expectedTotal) {
        throw new Error("Incomplete Printify order history")
      }
      return Object.fromEntries(counts)
    }
    if (data.data.length === 0) throw new Error("Incomplete Printify order history")
  }
  throw new Error("Printify order history exceeds pagination limit")
}
