import { z } from "zod"

import type { AdminOrderFilters } from "./admin-order"

const paymentFilters = new Set(["paid", "unverified", "all"])
const fulfillmentFilters = new Set(["all", "pending", "attention", "submitted"])
const channelFilters = new Set(["all", "organic_search", "paid", "social", "email", "referral", "direct", "unknown"])
const modeFilters = new Set(["live", "test", "all"])

export function parseAdminOrderFilters(params: Record<string, string | string[] | undefined>): AdminOrderFilters {
  const first = (key: string) => (typeof params[key] === "string" ? params[key] : undefined)
  const page = Number(first("page"))
  const orderId = z.uuid().safeParse(first("order"))
  return {
    ...(orderId.success ? { orderId: orderId.data } : {}),
    page: Number.isSafeInteger(page) && page >= 1 && page <= 1000 ? page : 1,
    payment: paymentFilters.has(first("payment") ?? "") ? (first("payment") as AdminOrderFilters["payment"]) : "paid",
    fulfillment: fulfillmentFilters.has(first("fulfillment") ?? "")
      ? (first("fulfillment") as AdminOrderFilters["fulfillment"])
      : "all",
    channel: channelFilters.has(first("channel") ?? "") ? (first("channel") as AdminOrderFilters["channel"]) : "all",
    mode: modeFilters.has(first("mode") ?? "") ? (first("mode") as AdminOrderFilters["mode"]) : "live",
  }
}
