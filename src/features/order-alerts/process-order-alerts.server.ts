import "server-only"

import type { Pool } from "pg"
import { getShippingSchedule } from "@/features/store-policies/get-shipping-schedule"
import { storeTimeZone } from "@/lib/store-time-zone"
import { buildOrderAlertEmail } from "./build-order-alert-email"
import type { AlertOrder, OwnerEmail, PaymentCheck, ShipmentCheck } from "./order-alert"

type AlertRow = AlertOrder & {
  email_day: string | null
  email_payload: OwnerEmail | null
  attempt_started_at: Date | null
  sent_at: Date | null
  sent_day: string | null
}

export async function processOrderAlerts(deps: {
  pool: Pool
  shopId: string
  from: string
  siteUrl: string
  now?: Date
  checkShipment: (order: AlertOrder) => Promise<ShipmentCheck>
  checkPayment: (order: AlertOrder) => Promise<PaymentCheck>
  send: (email: OwnerEmail, key: string) => Promise<string>
}) {
  const now = deps.now ?? new Date()
  const calendar = getShippingSchedule(now.toISOString(), 10, now, storeTimeZone)
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: storeTimeZone, hour: "numeric", hourCycle: "h23" }).format(now)
  )
  if (!calendar.isBusinessDay || hour < 9) return { checked: 0, sent: 0, errors: 0, reason: "outside_business_hours" }
  const client = await deps.pool.connect()
  const lock = `order-alerts:${deps.shopId}`
  let locked = false
  let destroy = false
  const result = { checked: 0, sent: 0, errors: 0, reason: "processed" }
  try {
    locked =
      (
        await client.query<{ locked: boolean }>("select pg_try_advisory_lock(hashtextextended($1, 0)) as locked", [
          lock,
        ])
      ).rows[0]?.locked ?? false
    if (!locked) return { ...result, reason: "already_running" }
    const candidates = await client.query<AlertRow>(
      `
      select o.request_id, o.snapshot, o.payment, o.session_id, o.printify_order_id, o.state, o.failure_code,
             a.email_day, a.email_payload, a.attempt_started_at, a.sent_at,
             to_char(a.sent_at at time zone (o.snapshot->'shippingEstimate'->>'timeZone'), 'YYYY-MM-DD') as sent_day
        from commerce.checkout_orders o
        left join commerce.order_shipping_alerts a on a.request_id = o.request_id
       where o.snapshot->>'shopId' = $1 and o.payment->>'status' = 'paid'
         and o.payment->>'livemode' = 'true' and o.state <> 'simulated'
         and a.completed_reason is null and (a.next_check_at is null or a.next_check_at <= $2)
       order by coalesce(a.next_check_at, o.created_at), o.request_id limit 10`,
      [deps.shopId, now]
    )
    const started = Date.now()
    for (const order of candidates.rows) {
      if (Date.now() - started > 45_000) break
      result.checked++
      // Advance before I/O so one broken order cannot starve later candidates on every run.
      await client.query(
        `insert into commerce.order_shipping_alerts(request_id,next_check_at,updated_at)
        values($1,$2::timestamptz + interval '1 hour',$2)
        on conflict(request_id) do update set next_check_at=excluded.next_check_at, updated_at=excluded.updated_at`,
        [order.request_id, now]
      )
      try {
        const estimate = order.snapshot.shippingEstimate
        if (estimate.calendar !== "us-federal-v1") throw new Error("Unknown saved calendar")
        const schedule = getShippingSchedule(
          order.payment.paidAt,
          estimate.handlingBusinessDays,
          now,
          estimate.timeZone
        )
        if (schedule.today < schedule.alertDate) {
          await client.query(
            `update commerce.order_shipping_alerts
            set next_check_at=($2::date + time '09:00') at time zone $3 where request_id=$1`,
            [order.request_id, schedule.alertDate, estimate.timeZone]
          )
          continue
        }
        const [shipment, payment] = await Promise.all([deps.checkShipment(order), deps.checkPayment(order)])
        if (shipment.complete || payment === "refunded") {
          await client.query(
            `update commerce.order_shipping_alerts set completed_reason=$2, email_payload=null,
            email_day=null, attempt_started_at=null, sent_at=null, last_error=null where request_id=$1`,
            [order.request_id, shipment.complete ? "shipped" : "refunded"]
          )
          continue
        }
        if (order.sent_day === schedule.today) continue
        // Persist exact payload BEFORE send. Retrying a lost response must keep Resend's key AND body.
        // Its deduplication lasts 24h: never retry an old payload beyond our conservative 23h cutoff.
        const retry =
          order.email_payload &&
          order.attempt_started_at &&
          !order.sent_at &&
          now.getTime() - order.attempt_started_at.getTime() < 23 * 60 * 60 * 1000
        if (!retry && order.email_day === schedule.today) continue
        const email = retry
          ? order.email_payload!
          : buildOrderAlertEmail({ order, shipment, payment, now, from: deps.from, siteUrl: deps.siteUrl })
        const day = retry ? order.email_day! : schedule.today
        if (!retry)
          await client.query(
            `update commerce.order_shipping_alerts
          set email_day=$2, email_payload=$3, attempt_started_at=$4, sent_at=null, provider_email_id=null, last_error=null
          where request_id=$1`,
            [order.request_id, day, email, now]
          )
        try {
          const receipt = await deps.send(email, `order-shipping/${order.request_id}/${day}`)
          await client.query(
            `update commerce.order_shipping_alerts set sent_at=$2, provider_email_id=$3, last_error=null where request_id=$1`,
            [order.request_id, now, receipt]
          )
          result.sent++
        } catch {
          result.errors++
          await client.query(
            "update commerce.order_shipping_alerts set last_error='send_unconfirmed' where request_id=$1",
            [order.request_id]
          )
        }
      } catch {
        result.errors++
        await client.query("update commerce.order_shipping_alerts set last_error='check_failed' where request_id=$1", [
          order.request_id,
        ])
      }
    }
    return result
  } finally {
    if (locked) {
      try {
        await client.query("select pg_advisory_unlock(hashtextextended($1, 0))", [lock])
      } catch {
        destroy = true
      }
    }
    client.release(destroy)
  }
}
