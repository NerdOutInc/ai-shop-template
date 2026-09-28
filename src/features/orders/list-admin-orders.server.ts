import "server-only"

import { getAdminDatabase } from "@/features/admin/get-admin-database.server"
import { requireAdmin } from "@/features/admin/require-admin.server"
import { orderAttributionSchema } from "@/features/attribution/order-attribution-schema"
import type { CheckoutPayment, FulfillmentState } from "@/features/checkout/checkout-order"
import { env } from "@/lib/env"

import type { AdminOrder, AdminOrderFilters, AdminOrderListResult } from "./admin-order"

type OrderRow = {
  request_id: string
  created_at: Date
  state: FulfillmentState
  printify_order_id: string | null
  failure_code: string | null
  payment: CheckoutPayment | null
  attribution: unknown
  recipient_name: string | null
  customer_email: string | null
}

const pageSize = 25

export async function listAdminOrders(filters: AdminOrderFilters): Promise<AdminOrderListResult> {
  // Authorize the read itself so a new consumer cannot accidentally bypass the page's gate.
  await requireAdmin(filters.orderId ? `/admin/orders?order=${filters.orderId}` : undefined)
  if (!env.PRINTIFY_SHOP_ID) return { status: "unavailable" }
  try {
    const result = await getAdminDatabase().query<OrderRow>(
      `select request_id, created_at, state, printify_order_id, failure_code, payment,
              snapshot->'attribution' as attribution,
              nullif(concat_ws(' ', snapshot->'shippingAddress'->>'firstName',
                                  snapshot->'shippingAddress'->>'lastName'), '') as recipient_name,
              snapshot->'shippingAddress'->>'email' as customer_email
         from commerce.checkout_orders
        where snapshot->>'shopId' = $1
          and ($2 = 'all' or ($2 = 'paid' and payment->>'status' = 'paid')
               or ($2 = 'unverified' and payment is null))
          and ($3 = 'all' or ($3 = 'test' and (payment->>'livemode' = 'false' or state = 'simulated'))
               or ($3 = 'live' and coalesce(payment->>'livemode', 'true') = 'true' and state <> 'simulated'))
          and ($4 = 'all' or ($4 = 'attention' and failure_code is not null)
               or ($4 = 'pending' and state in ('pending', 'creating', 'created', 'submitting'))
               or ($4 = 'submitted' and state = 'submitted'))
          and ($5 = 'all' or coalesce(snapshot->'attribution'->>'channel', 'unknown') = $5)
          and ($8::uuid is null or request_id = $8)
        order by created_at desc, request_id desc limit $6 offset $7`,
      [
        env.PRINTIFY_SHOP_ID,
        filters.payment,
        filters.mode,
        filters.fulfillment,
        filters.channel,
        pageSize + 1,
        (filters.page - 1) * pageSize,
        filters.orderId ?? null,
      ]
    )
    return {
      status: "ready",
      orders: result.rows.slice(0, pageSize).map(toAdminOrder),
      hasNextPage: result.rows.length > pageSize,
    }
  } catch {
    console.warn("Admin orders unavailable", { reason: "storage" })
    return { status: "unavailable" }
  }
}

function toAdminOrder(row: OrderRow): AdminOrder {
  const parsedAttribution = orderAttributionSchema.safeParse(row.attribution)
  const attribution = parsedAttribution.success ? parsedAttribution.data : null
  const payment = row.payment
  return {
    requestId: row.request_id,
    createdAt: row.created_at.toISOString(),
    customerName: payment?.customerName ?? null,
    recipientName: row.recipient_name,
    customerEmail: payment?.customerEmail ?? row.customer_email,
    totalAmount: payment?.totalAmount ?? null,
    currency: payment?.currency ?? "usd",
    paidAt: payment?.paidAt ?? null,
    paymentIntentId:
      payment?.paymentIntentId && /^pi_[A-Za-z0-9]+$/.test(payment.paymentIntentId) ? payment.paymentIntentId : null,
    paymentStatus: payment ? "paid" : "unverified",
    testOrder: payment?.livemode === false || row.state === "simulated",
    fulfillmentState: row.state,
    failureCode: row.failure_code,
    printifyOrderId: row.printify_order_id,
    source: attribution?.source ?? attribution?.referrerHost ?? null,
    referrerHost: attribution?.referrerHost ?? null,
    channel: attribution?.channel ?? "unknown",
    campaign: attribution?.utmCampaign ?? null,
    landingPath: attribution?.landingPath ?? null,
    attributionMethod: attribution?.method ?? null,
  }
}
