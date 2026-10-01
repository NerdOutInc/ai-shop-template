import "server-only"
import type { Pool, PoolClient } from "pg"

import type { SubscriberRecord } from "./subscriber-record"

type Row = {
  id: string
  email: string
  subscription_state: SubscriberRecord["state"]
  eligible: boolean
  source: string
  consent_copy_version: string
  signup_ip: string | null
  created_at: Date
  consented_at: Date
  confirmed_at: Date | null
  unsubscribed_at: Date | null
  last_unsubscribed_at: Date | null
  updated_at: string
  deliveries: number
  confirmations: number
}

// Explicit projection: never return the confirmation outbox's token hash or message payload.
async function read(
  database: Pool | PoolClient,
  column: "email" | "id",
  value: string
): Promise<SubscriberRecord | null> {
  const row = (
    await database.query<Row>(
      `select s.id, s.email, s.subscription_state,
    commerce.is_drop_subscriber_eligible(s) as eligible, s.source, s.consent_copy_version,
    host(s.signup_ip) as signup_ip, s.created_at, s.consented_at, s.confirmed_at,
    s.unsubscribed_at, s.last_unsubscribed_at, s.updated_at::text as updated_at,
    (select count(*)::int from commerce.drop_email_deliveries d where d.subscriber_id = s.id) as deliveries,
    (select count(*)::int from commerce.drop_signup_confirmations c where c.subscriber_id = s.id) as confirmations
    from commerce.drop_subscribers s where s.${column} = $1`,
      [value]
    )
  ).rows[0]
  if (!row) return null
  return {
    id: row.id,
    email: row.email,
    state: row.subscription_state,
    eligible: row.eligible,
    source: row.source,
    consentVersion: row.consent_copy_version,
    signupIp: row.signup_ip,
    createdAt: row.created_at.toISOString(),
    consentedAt: row.consented_at.toISOString(),
    confirmedAt: row.confirmed_at?.toISOString() ?? null,
    unsubscribedAt: row.unsubscribed_at?.toISOString() ?? null,
    lastUnsubscribedAt: row.last_unsubscribed_at?.toISOString() ?? null,
    // Preserve PostgreSQL's full precision for the later erasure precondition.
    updatedAt: row.updated_at,
    deliveries: row.deliveries,
    confirmations: row.confirmations,
  }
}

/** Trusted server access. Each route must verify the current admin before calling this store. */
export class SubscriberAdminStore {
  constructor(private readonly pool: Pool) {}

  lookup(email: string) {
    return read(this.pool, "email", email)
  }
  readById(id: string) {
    return read(this.pool, "id", id)
  }
}
