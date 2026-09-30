import "server-only"

import type { Pool, PoolClient } from "pg"

import type { ProductWeek } from "@/features/publishing/product-schedule-entry"

import type { DropEmailMessage, FrozenDropEmail } from "./drop-email-message"
import type { DropEmailProduct } from "./drop-email-product"
import { dropEmailSubscriberPlaceholder } from "./drop-email-subscriber-placeholder"
import { dropUnsubscribeUrls } from "./drop-unsubscribe-urls"
import { personalizeDropEmail } from "./personalize-drop-email"
import { readDropEmailWindow } from "./read-drop-email-window"
import { renderDropEmail } from "./render-drop-email"
import type { DropEmailSendOutcome } from "./send-drop-email.server"

export type DropEmailRun = {
  reason:
    "processed" | "already_running" | "no_drop" | "not_yet" | "window_closed" | "no_products" | "catalog_unavailable"
  queued: number
  sent: number
  rejected: number
  /** Anything the owner should look at. The cron answers 503 when this is not zero. */
  errors: number
}

type Candidate = { subscriber_id: string; status: "queued" | "unconfirmed" }

// Resend deduplicates a key for 24 hours; stop retrying one well inside that.
const retryWindow = "23 hours"
// Leaves a cron invocation room to finish its writes inside maxDuration.
const runBudgetMs = 45_000
// Several refusals in one run look like a problem with the sender, not with several addresses.
const rejectionLimit = 3

/**
 * One pass of the weekly drop email, run by cron every 15 minutes.
 *
 * On the drop's morning the first pass freezes the email and its recipient list together; every pass
 * after that sends whatever is still queued, paced under Resend's rate limit, and retries an
 * unconfirmed send only under its original key. The shape of the owner alerts: state is written
 * before provider I/O, so a crash mid-send leaves an honest trace rather than a second email.
 */
export async function processDropEmails(deps: {
  pool: Pool
  now?: Date
  from: string
  replyTo: string
  siteUrl: string
  postalAddress: string
  readWeek: (now: number) => Promise<ProductWeek | null>
  readProducts: (week: ProductWeek) => Promise<DropEmailProduct[] | null>
  send: (message: DropEmailMessage, idempotencyKey: string) => Promise<DropEmailSendOutcome>
  /** Between sends. Resend allows a few requests a second per account, shared with sign-in codes. */
  pause?: () => Promise<void>
}): Promise<DropEmailRun> {
  const now = deps.now ?? new Date()
  const pause = deps.pause ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 600)))
  const result: DropEmailRun = { reason: "processed", queued: 0, sent: 0, rejected: 0, errors: 0 }
  const client = await deps.pool.connect()
  let locked = false
  let destroy = false
  try {
    locked =
      (
        await client.query<{ locked: boolean }>(
          "select pg_try_advisory_lock(hashtextextended('drop-emails', 0)) as locked"
        )
      ).rows[0]?.locked ?? false
    if (!locked) return { ...result, reason: "already_running" }

    const week = await deps.readWeek(now.getTime())
    // A past week's leftovers, or an unconfirmed send too old to retry under its key, are over.
    await client.query(
      `update commerce.drop_email_deliveries set status = 'expired', updated_at = $1
        where status in ('queued', 'unconfirmed')
          and (drop_live_at is distinct from $2::timestamptz
               or attempt_started_at < $1::timestamptz - interval '${retryWindow}')`,
      [now, week?.liveAt ?? null]
    )
    if (!week) return { ...result, reason: "no_drop" }

    const window = readDropEmailWindow(week.liveAt, now.getTime())
    let frozen = await readFrozen(client, week.liveAt)
    if (!frozen) {
      if (window.state === "early") return { ...result, reason: "not_yet" }
      if (window.state === "closed") return { ...result, reason: "window_closed" }
      const products = await deps.readProducts(week)
      if (products === null) return { ...result, reason: "catalog_unavailable", errors: 1 }
      if (products.length === 0) return { ...result, reason: "no_products" }
      const email = await renderDropEmail({
        liveAt: week.liveAt,
        products,
        siteUrl: deps.siteUrl,
        postalAddress: deps.postalAddress,
        unsubscribeUrl: dropUnsubscribeUrls(deps.siteUrl, dropEmailSubscriberPlaceholder).page,
      })
      // One statement, so the email and its recipients exist together or not at all. Recipients are
      // whoever was signed up when the drop went live: someone who joins at 8 AM has already seen it.
      //
      // A return keeps created_at, so a returning subscriber counts from the consent their return
      // refreshed instead: the same cutoff as someone new. Submitting the form again once back
      // refreshes that consent too and reads as a later return, so when this errs, it errs toward a
      // skipped drop rather than an unwanted email.
      const queued = await client.query(
        `with frozen as (
           insert into commerce.drop_emails
             (live_at, from_address, reply_to, subject, html, text_body, product_ids, frozen_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           on conflict (live_at) do nothing
           returning live_at
         )
         insert into commerce.drop_email_deliveries (drop_live_at, subscriber_id, created_at, updated_at)
         select frozen.live_at, subscriber.id, $8, $8
           from frozen cross join commerce.drop_subscribers subscriber
          where subscriber.unsubscribed_at is null
            and case when subscriber.last_unsubscribed_at is null then subscriber.created_at
                     else subscriber.consented_at end < frozen.live_at`,
        [
          week.liveAt,
          deps.from,
          deps.replyTo,
          email.subject,
          email.html,
          email.text,
          products.map((product) => product.id),
          now,
        ]
      )
      result.queued = queued.rowCount ?? 0
      frozen = await readFrozen(client, week.liveAt)
      if (!frozen) throw new Error("The drop email was not saved")
    }
    // A first attempt belongs to the drop's day, however the day ended: a rate limit, sending
    // switched off, or a queue longer than the day. After midnight only an unconfirmed send may go
    // again, under its original key and inside its 23 hours.
    if (window.state === "closed")
      await client.query(
        `update commerce.drop_email_deliveries set status = 'expired', updated_at = $2
          where drop_live_at = $1 and status = 'queued'`,
        [week.liveAt, now]
      )

    // Leaving after the list was frozen still counts: nobody hears from us after they say stop.
    await client.query(
      `update commerce.drop_email_deliveries delivery set status = 'unsubscribed', updated_at = $2
         from commerce.drop_subscribers subscriber
        where delivery.subscriber_id = subscriber.id and delivery.drop_live_at = $1
          and delivery.status in ('queued', 'unconfirmed') and subscriber.unsubscribed_at is not null`,
      [week.liveAt, now]
    )
    const candidates = await client.query<Candidate>(
      `select delivery.subscriber_id, delivery.status
         from commerce.drop_email_deliveries delivery
         join commerce.drop_subscribers subscriber on subscriber.id = delivery.subscriber_id
        where delivery.drop_live_at = $1 and delivery.status in ('queued', 'unconfirmed')
        order by subscriber.created_at, subscriber.id
        limit 100`,
      [week.liveAt]
    )
    const started = Date.now()
    const drop = new Date(week.liveAt).toISOString()
    for (const [index, candidate] of candidates.rows.entries()) {
      if (Date.now() - started > runBudgetMs) break
      if (index > 0) await pause()
      const key = [week.liveAt, candidate.subscriber_id]
      // Claimed one at a time against the subscriber as they are right now, first attempts and
      // retries alike. Someone who unsubscribes while this run is sending to others is not written
      // to; only a request already on its way to Resend when they click cannot be called back.
      const claimed = await client.query<{ email: string }>(
        `update commerce.drop_email_deliveries delivery
            set status = 'unconfirmed', attempt_started_at = coalesce(delivery.attempt_started_at, $3),
                updated_at = $3
           from commerce.drop_subscribers subscriber
          where delivery.drop_live_at = $1 and delivery.subscriber_id = $2
            and subscriber.id = delivery.subscriber_id and subscriber.unsubscribed_at is null
            and delivery.status in ('queued', 'unconfirmed')
          returning subscriber.email`,
        [...key, now]
      )
      const email = claimed.rows[0]?.email
      if (!email) {
        await client.query(
          `update commerce.drop_email_deliveries set status = 'unsubscribed', updated_at = $3
            where drop_live_at = $1 and subscriber_id = $2 and status in ('queued', 'unconfirmed')`,
          [...key, now]
        )
        continue
      }
      const outcome = await deps.send(
        personalizeDropEmail(frozen, { id: candidate.subscriber_id, email }, deps.siteUrl),
        `drop-email/${drop}/${candidate.subscriber_id}`
      )
      if (outcome.status === "sent") {
        await client.query(
          `update commerce.drop_email_deliveries
              set status = 'sent', sent_at = $3, provider_email_id = $4, updated_at = $3
            where drop_live_at = $1 and subscriber_id = $2`,
          [...key, now, outcome.providerEmailId]
        )
        result.sent++
      } else if (outcome.status === "rejected") {
        await client.query(
          `update commerce.drop_email_deliveries set status = 'rejected', updated_at = $3
            where drop_live_at = $1 and subscriber_id = $2`,
          [...key, now]
        )
        result.rejected++
        if (result.rejected >= rejectionLimit) {
          result.errors++
          break
        }
      } else if (outcome.status === "not-sent") {
        // Nothing went out, so a first attempt goes back in the queue. A retry keeps its original
        // attempt time: an earlier try may still have been delivered, and its key has a deadline.
        if (candidate.status === "queued")
          await client.query(
            `update commerce.drop_email_deliveries
                set status = 'queued', attempt_started_at = null, updated_at = $3
              where drop_live_at = $1 and subscriber_id = $2 and status = 'unconfirmed'`,
            [...key, now]
          )
        result.errors++
        break
      } else {
        result.errors++
      }
    }
    return result
  } finally {
    if (locked) {
      try {
        await client.query("select pg_advisory_unlock(hashtextextended('drop-emails', 0))")
      } catch {
        destroy = true
      }
    }
    client.release(destroy)
  }
}

async function readFrozen(client: PoolClient, liveAt: string): Promise<FrozenDropEmail | null> {
  const row = (
    await client.query<{ from_address: string; reply_to: string; subject: string; html: string; text_body: string }>(
      "select from_address, reply_to, subject, html, text_body from commerce.drop_emails where live_at = $1",
      [liveAt]
    )
  ).rows[0]
  return row
    ? {
        fromAddress: row.from_address,
        replyTo: row.reply_to,
        subject: row.subject,
        html: row.html,
        textBody: row.text_body,
      }
    : null
}
