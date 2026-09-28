import type { AdminOrderFilters } from "./admin-order"

export function adminOrderPageUrl(filters: AdminOrderFilters, page: number): string {
  const params = new URLSearchParams({
    payment: filters.payment,
    fulfillment: filters.fulfillment,
    channel: filters.channel,
    mode: filters.mode,
    page: String(page),
  })
  if (filters.orderId) params.set("order", filters.orderId)
  return `/admin/orders?${params}`
}
