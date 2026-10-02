import "server-only"
import type { Pool, PoolClient } from "pg"
import { readSignupConfirmationBudget } from "./read-signup-confirmation-budget.server"
import type { SingleRecipientEmailMessage } from "@/lib/single-recipient-email-message"
import type { SingleEmailSendOutcome } from "@/lib/send-single-email.server"

/** Freeze before I/O, retain unknown attempts, and never invent a new key for an uncertain send. */
export async function processSignupConfirmations(deps: {
  pool: Pool
  id?: string
  send: (message: SingleRecipientEmailMessage, key: string) => Promise<SingleEmailSendOutcome>
  pause?: () => Promise<void>
}) {
  let client: PoolClient | undefined
  let locked = false
  let destroy = false
  const result = {
    sent: 0,
    errors: 0,
    busy: false,
    saturated: (await readSignupConfirmationBudget(deps.pool)).saturated,
  }
  try {
    const lockDeadline = Date.now() + (deps.id ? 5_000 : 0)
    do {
      client = await deps.pool.connect()
      locked =
        (
          await client.query<{ locked: boolean }>(
            "select pg_try_advisory_lock(hashtextextended('signup-confirmations', 0)) as locked"
          )
        ).rows[0]?.locked ?? false
      if (locked || Date.now() >= lockDeadline) break
      // A lock waiter should not occupy the shared email pool between attempts.
      client.release()
      client = undefined
      await new Promise<void>((resolve) => setTimeout(resolve, 250))
    } while (Date.now() < lockDeadline)
    if (!locked) {
      result.busy = true
      return result
    }
    if (!client) throw new Error("Signup worker lock has no connection")
    await client.query(`update commerce.drop_signup_confirmations set status = 'expired', message = null
      where status in ('queued', 'unconfirmed') and (expires_at <= now() or revoked_at is not null or used_at is not null
        or attempt_started_at < now() - interval '23 hours')`)
    const candidates = await client.query<{ id: string }>(
      `select id from commerce.drop_signup_confirmations
      where status in ('queued', 'unconfirmed') and next_attempt_at <= now() and ($1::uuid is null or id = $1)
      order by created_at limit 40`,
      [deps.id ?? null]
    )
    const started = Date.now()
    for (const row of candidates.rows) {
      if (Date.now() - started > 40_000) break
      await (deps.pause?.() ?? new Promise<void>((resolve) => setTimeout(resolve, 600)))
      const claim = (
        await client.query<{ message: SingleRecipientEmailMessage }>(
          `update commerce.drop_signup_confirmations
        set status = 'unconfirmed', attempt_started_at = coalesce(attempt_started_at, now()),
          last_attempt_at = now(), last_provider_outcome = 'unconfirmed', attempts = attempts + 1, next_attempt_at = now() + interval '15 minutes'
        where id = $1 and status in ('queued', 'unconfirmed') and message is not null
          and revoked_at is null and used_at is null and expires_at > now()
        returning message`,
          [row.id]
        )
      ).rows[0]
      if (!claim) continue
      let outcome: SingleEmailSendOutcome
      try {
        outcome = await deps.send(claim.message, `signup-confirmation/${row.id}`)
      } catch {
        outcome = { status: "unconfirmed" }
      }
      await client.query("update commerce.drop_signup_confirmations set last_provider_outcome = $2 where id = $1", [
        row.id,
        outcome.status,
      ])
      if (outcome.status === "sent") {
        await client.query(
          `update commerce.drop_signup_confirmations set status = 'sent', provider_email_id = $2,
          accepted_at = now(), message = null where id = $1`,
          [row.id, outcome.providerEmailId]
        )
        result.sent++
      } else if (outcome.status === "rejected") {
        await client.query(
          "update commerce.drop_signup_confirmations set status = 'rejected', message = null where id = $1",
          [row.id]
        )
        result.errors++
        if (result.errors >= 3) break
      } else {
        result.errors++
        // A known refusal can be retried too, but keeps the same frozen request and original deadline.
        if (outcome.status === "not-sent") break
      }
    }
    result.saturated = (await readSignupConfirmationBudget(client)).saturated
    return result
  } finally {
    if (locked) {
      try {
        await client?.query("select pg_advisory_unlock(hashtextextended('signup-confirmations', 0))")
      } catch {
        destroy = true
      }
    }
    client?.release(destroy)
  }
}
