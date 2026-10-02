import "server-only"
import { createHash, randomBytes } from "node:crypto"
import type { Pool } from "pg"

import { dropConsentCopy } from "./drop-consent-copy"
import { renderSignupConfirmation } from "./render-signup-confirmation"

export async function queueSignupConfirmation(
  pool: Pool,
  input: {
    hourlyLimit?: number
    email: string
    source: string
    signupIp: string | null
    from: string
    replyTo: string
    siteUrl: string
  }
): Promise<string | null> {
  const hourlyLimit = input.hourlyLimit ?? 20
  if (!Number.isInteger(hourlyLimit) || hourlyLimit < 1 || hourlyLimit > 1000)
    throw new Error("Invalid confirmation ceiling")
  const client = await pool.connect()
  try {
    await client.query("begin")
    await client.query(
      `insert into commerce.drop_subscribers (email, source, consent_copy_version, signup_ip)
      values ($1, $2, $3, $4::inet) on conflict (email) do nothing`,
      [input.email, input.source, dropConsentCopy.version, input.signupIp]
    )
    // All signup/confirm operations lock the subscriber first. This bounds concurrent resends.
    const subscriber = (
      await client.query<{ id: string; eligible: boolean }>(
        `select id, commerce.is_drop_subscriber_eligible(subscriber) as eligible
        from commerce.drop_subscribers subscriber where email = $1 for update`,
        [input.email]
      )
    ).rows[0]!
    if (subscriber.eligible) {
      await client.query("commit")
      return null
    }
    const limits = (
      await client.query<{ blocked: boolean }>(
        `select count(*) >= 3 or coalesce(max(created_at) > now() - interval '15 minutes', false) as blocked
        from commerce.drop_signup_confirmations where subscriber_id = $1 and created_at > now() - interval '24 hours'`,
        [subscriber.id]
      )
    ).rows[0]!
    // Eligible addresses and cooldowns share the accepted response; provider work runs after it.
    if (limits.blocked) {
      await client.query("commit")
      return null
    }
    // Serialize the store-wide rolling budget after address checks; keep no recipient identifiers.
    await client.query("select singleton from commerce.drop_signup_confirmation_budget for update")
    const budget = (
      await client.query<{ limited: boolean }>(
        `update commerce.drop_signup_confirmation_budget set
        queued_at = array(select stamp from unnest(queued_at) stamp where stamp > now() - interval '1 hour')
       returning cardinality(queued_at) >= $1 as limited`,
        [hourlyLimit]
      )
    ).rows[0]!
    if (budget.limited) {
      await client.query("update commerce.drop_signup_confirmation_budget set blocked_at = now()")
      await client.query("commit")
      return "limited"
    }
    await client.query("update commerce.drop_signup_confirmation_budget set queued_at = array_append(queued_at, now())")
    const token = randomBytes(32).toString("hex")
    const message = renderSignupConfirmation({ ...input, token })
    message.to = [input.email]
    await client.query(
      `update commerce.drop_signup_confirmations set revoked_at = now(), message = null
      where subscriber_id = $1 and used_at is null and revoked_at is null`,
      [subscriber.id]
    )
    const { rows } = await client.query<{ id: string }>(
      `insert into commerce.drop_signup_confirmations (subscriber_id, token_hash, source, consent_copy_version, signup_ip, message)
       values ($1, $2, $3, $4, $5::inet, $6::jsonb) returning id`,
      [
        subscriber.id,
        createHash("sha256").update(token).digest("hex"),
        input.source,
        dropConsentCopy.version,
        input.signupIp,
        JSON.stringify(message),
      ]
    )
    await client.query("commit")
    return rows[0]!.id
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}
