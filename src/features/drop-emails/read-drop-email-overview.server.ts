import "server-only"

import type { Pool } from "pg"

import type { DropEmailHistoryEntry } from "./drop-email-history-entry"
import { getDropEmailPool } from "./get-drop-email-pool.server"

export type DropEmailOverview =
  | { status: "ready"; subscribed: number; pending: number; unsubscribed: number; history: DropEmailHistoryEntry[] }
  | { status: "unavailable" }

type HistoryRow = {
  live_at: Date
  subject: string
  product_count: number
  recipients: number
  sent: number
  pending: number
  failed: number
  unsubscribed: number
  first_sent_at: Date | null
  last_sent_at: Date | null
}

/** How big the list is and what the last dozen drop emails did. Called only after an admin check. */
export async function readDropEmailOverview(pool?: Pool): Promise<DropEmailOverview> {
  try {
    const database = pool ?? getDropEmailPool()
    const [counts, history] = await Promise.all([
      database.query<{ subscribed: number; pending: number; unsubscribed: number }>(
        `select count(*) filter (where commerce.is_drop_subscriber_eligible(subscriber))::int as subscribed,
                count(*) filter (where unsubscribed_at is null and subscription_state = 'pending')::int as pending,
                count(*) filter (where unsubscribed_at is not null)::int as unsubscribed
           from commerce.drop_subscribers subscriber`
      ),
      database.query<HistoryRow>(
        `select email.live_at, email.subject, cardinality(email.product_ids) as product_count,
                count(delivery.subscriber_id)::int as recipients,
                count(*) filter (where delivery.status = 'sent')::int as sent,
                count(*) filter (where delivery.status in ('queued', 'unconfirmed'))::int as pending,
                count(*) filter (where delivery.status in ('rejected', 'expired'))::int as failed,
                count(*) filter (where delivery.status = 'unsubscribed')::int as unsubscribed,
                min(delivery.sent_at) as first_sent_at, max(delivery.sent_at) as last_sent_at
           from commerce.drop_emails email
           left join commerce.drop_email_deliveries delivery on delivery.drop_live_at = email.live_at
          group by email.live_at
          order by email.live_at desc
          limit 12`
      ),
    ])
    return {
      status: "ready",
      subscribed: counts.rows[0]?.subscribed ?? 0,
      pending: counts.rows[0]?.pending ?? 0,
      unsubscribed: counts.rows[0]?.unsubscribed ?? 0,
      history: history.rows.map((row) => ({
        liveAt: row.live_at.toISOString(),
        subject: row.subject,
        productCount: row.product_count,
        recipients: row.recipients,
        sent: row.sent,
        pending: row.pending,
        failed: row.failed,
        unsubscribed: row.unsubscribed,
        firstSentAt: row.first_sent_at?.toISOString() ?? null,
        lastSentAt: row.last_sent_at?.toISOString() ?? null,
      })),
    }
  } catch {
    console.warn("Drop email overview unavailable", { reason: "storage" })
    return { status: "unavailable" }
  }
}
