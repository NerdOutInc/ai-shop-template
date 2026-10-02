import "server-only"
import { createHash } from "node:crypto"
import type { Pool } from "pg"

export type SignupConfirmationResult = "confirmed" | "expired"

/** A POST-only caller supplies the capability. No read or GET consumes it. */
export async function confirmDropSignup(pool: Pool, token: string): Promise<SignupConfirmationResult> {
  if (!/^[a-f0-9]{64}$/.test(token)) return "expired"
  const hash = createHash("sha256").update(token).digest("hex")
  const client = await pool.connect()
  try {
    await client.query("begin")
    const id = (
      await client.query<{ subscriber_id: string }>(
        "select subscriber_id from commerce.drop_signup_confirmations where token_hash = $1",
        [hash]
      )
    ).rows[0]?.subscriber_id
    if (!id) {
      await client.query("commit")
      return "expired"
    }
    const subscriber = (
      await client.query<{ unsubscribed_at: Date | null }>(
        "select unsubscribed_at from commerce.drop_subscribers where id = $1 for update",
        [id]
      )
    ).rows[0]
    const request = (
      await client.query<{ id: string; used_at: Date | null; revoked_at: Date | null; valid: boolean }>(
        `select id, used_at, revoked_at, expires_at > now() as valid
        from commerce.drop_signup_confirmations where token_hash = $1 for update`,
        [hash]
      )
    ).rows[0]
    if (
      !subscriber ||
      !request ||
      request.revoked_at ||
      (!request.used_at && !request.valid) ||
      (request.used_at && subscriber.unsubscribed_at)
    ) {
      await client.query("commit")
      return "expired"
    }
    if (!request.used_at) {
      await client.query(
        "update commerce.drop_signup_confirmations set used_at = now(), message = null where id = $1",
        [request.id]
      )
      await client.query(
        `update commerce.drop_subscribers s set subscription_state = 'confirmed',
        confirmed_at = c.used_at, consented_at = c.used_at, source = c.source,
        consent_copy_version = c.consent_copy_version, signup_ip = coalesce(c.signup_ip, s.signup_ip),
        last_unsubscribed_at = coalesce(s.unsubscribed_at, s.last_unsubscribed_at),
        unsubscribed_at = null, updated_at = now()
        from commerce.drop_signup_confirmations c where s.id = $1 and c.id = $2`,
        [id, request.id]
      )
    }
    await client.query("commit")
    return "confirmed"
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}
