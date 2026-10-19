import "server-only"

import type { Pool } from "pg"
import { getCommerceServices } from "@/features/checkout/get-commerce-services.server"
import { getSharedPostgresPool } from "@/lib/get-shared-postgres-pool.server"
import { env } from "@/lib/env"
import { processOrderAlerts } from "./process-order-alerts.server"
import { readOrderPayment } from "./read-order-payment.server"
import { readOrderShipment } from "./read-order-shipment.server"
import { sendOrderAlert } from "./send-order-alert.server"

let pool: Pool | undefined

export async function runOrderAlerts() {
  if (
    !env.DATABASE_URL ||
    !env.RESEND_API_KEY ||
    !env.ORDER_ALERT_FROM_EMAIL ||
    !env.PRINTIFY_SHOP_ID ||
    !env.ADMIN_LIBRARY_ENABLED
  )
    throw new Error("Owner alerts are not configured")
  const services = getCommerceServices()
  if (!services.expectedLivemode) throw new Error("Owner alerts require live payment reads")
  pool ??= getSharedPostgresPool(env.DATABASE_URL, "alerts")
  return processOrderAlerts({
    pool,
    shopId: env.PRINTIFY_SHOP_ID,
    from: env.ORDER_ALERT_FROM_EMAIL,
    siteUrl: services.siteUrl,
    checkShipment: (order) => readOrderShipment(services.printify, order),
    checkPayment: (order) => readOrderPayment(services.stripe, order),
    send: (email, key) => sendOrderAlert(env.RESEND_API_KEY!, email, key),
  })
}
