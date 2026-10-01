import "server-only"
import type { Pool } from "pg"

/** A bounded maintenance pass: only never-confirmed, never-stopped pending consent can expire. */
export async function prunePendingSubscribers(pool: Pool): Promise<number> {
  const client = await pool.connect()
  try {
    await client.query("begin")
    await client.query("set local lock_timeout = '1s'")
    for (const worker of ["drop-emails", "signup-confirmations"]) {
      const acquired = (
        await client.query<{ locked: boolean }>("select pg_try_advisory_xact_lock(hashtextextended($1, 0)) as locked", [
          worker,
        ])
      ).rows[0]?.locked
      if (!acquired) {
        await client.query("rollback")
        return 0
      }
    }
    // Lock first, then evaluate expiry in a fresh statement snapshot. A resend can finish
    // between candidate selection and its row lock without updating the subscriber's revision.
    const candidates = await client.query<{ id: string }>(`select s.id from commerce.drop_subscribers s
      where s.subscription_state = 'pending' and s.confirmed_at is null and s.unsubscribed_at is null
        and s.created_at <= now() - interval '24 hours'
        and coalesce((select max(c.expires_at) from commerce.drop_signup_confirmations c where c.subscriber_id=s.id),
                     s.created_at + interval '24 hours') <= now()
      order by s.created_at limit 100 for update of s skip locked`)
    const result = await client.query(
      `delete from commerce.drop_subscribers s
      where s.id = any($1::uuid[]) and s.subscription_state = 'pending'
        and s.confirmed_at is null and s.unsubscribed_at is null
        and coalesce((select max(c.expires_at) from commerce.drop_signup_confirmations c where c.subscriber_id=s.id),
                     s.created_at + interval '24 hours') <= now()`,
      [candidates.rows.map((row) => row.id)]
    )
    await client.query("commit")
    return result.rowCount ?? 0
  } catch (error) {
    await client.query("rollback")
    if (error && typeof error === "object" && "code" in error && error.code === "55P03") return 0
    throw error
  } finally {
    client.release()
  }
}
