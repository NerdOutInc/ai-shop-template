import "server-only"
import { createHash, randomBytes } from "node:crypto"
import type { Pool } from "pg"

import { dropConsentCopy } from "./drop-consent-copy"
import { renderSignupConfirmation } from "./render-signup-confirmation"

export async function queueSignupConfirmation(
  pool: Pool,
  input: {
    email: string
    source: string
    signupIp: string | null
    from: string
    replyTo: string
    siteUrl: string
    hourlyLimit?: number
    requestSubject?: string
  }
): Promise<string | null> {
  const hourlyLimit = input.hourlyLimit ?? 20
  if (!Number.isInteger(hourlyLimit) || hourlyLimit < 1 || hourlyLimit > 1000)
    throw new Error("Invalid confirmation hourly limit")
  const client = await pool.connect()
  try {
    await client.query("begin")
    // Admission must precede every address-dependent branch. Otherwise another request's
    // remaining capacity reveals whether a target is eligible or in its resend cooldown.
    const subjectHash = input.requestSubject
      ? createHash("sha256").update(`signup-hour:${input.requestSubject}`).digest("hex")
      : null
    await client.query(
      `insert into commerce.drop_signup_confirmation_budget (singleton) values (true) on conflict do nothing`
    )
    await client.query(
      `select singleton from commerce.drop_signup_confirmation_budget where singleton = true for update`
    )
    const budget = (
      await client.query<{ count: number; identity_count: number }>(
        `with recent as (
          select coalesce(array_agg(stamp), '{}'::timestamptz[]) as stamps,
            coalesce(array_agg(subject), '{}'::text[]) as subjects
          from commerce.drop_signup_confirmation_budget, unnest(accepted_at, subject_hashes) as request(stamp, subject)
          where stamp > clock_timestamp() - interval '1 hour'
        )
        update commerce.drop_signup_confirmation_budget set accepted_at = recent.stamps, subject_hashes = recent.subjects
        from recent where singleton = true returning cardinality(accepted_at) as count,
          (select count(*)::int from unnest(subject_hashes) subject where subject = $1) as identity_count`,
        [subjectHash]
      )
    ).rows[0]!
    if (budget.count >= hourlyLimit) {
      await client.query(
        `update commerce.drop_signup_confirmation_budget set blocked_at = clock_timestamp() where singleton = true`
      )
      await client.query("commit")
      console.warn("Signup confirmation hourly ceiling reached")
      return "busy"
    }
    if (subjectHash && budget.identity_count >= Math.max(1, Math.floor(hourlyLimit / 4))) {
      await client.query("commit")
      return "rate-limited"
    }
    // Count all admitted requests, including eligible addresses and resends with no new mail.
    // Paired hashes expire with their timestamps; subscriber erasure cannot reset either quota.
    await client.query(
      `update commerce.drop_signup_confirmation_budget set accepted_at = array_append(accepted_at, clock_timestamp()),
        subject_hashes = array_append(subject_hashes, $1::text) where singleton = true`,
      [subjectHash]
    )
    let subscriber: { id: string; eligible: boolean } | undefined
    // Erasure can win after ON CONFLICT DO NOTHING but before the row lock. Retry the
    // insert once in a fresh statement snapshot; a fresh signup must receive a new UUID.
    for (let attempt = 0; attempt < 2 && !subscriber; attempt++) {
      await client.query(
        `insert into commerce.drop_subscribers (email, source, consent_copy_version, signup_ip)
        values ($1, $2, $3, $4::inet) on conflict (email) do nothing`,
        [input.email, input.source, dropConsentCopy.version, input.signupIp]
      )
      subscriber = (
        await client.query<{ id: string; eligible: boolean }>(
          `select id, commerce.is_drop_subscriber_eligible(subscriber) as eligible
        from commerce.drop_subscribers subscriber where email = $1 for update`,
          [input.email]
        )
      ).rows[0]
    }
    if (!subscriber) throw new Error("Signup changed during queueing")
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
