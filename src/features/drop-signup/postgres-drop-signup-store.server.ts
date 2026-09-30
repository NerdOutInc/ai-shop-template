import "server-only"

import { createHash } from "node:crypto"

import { createPostgresPool } from "@/lib/create-postgres-pool.server"

import { dropConsentCopy } from "./drop-consent-copy"

export class PostgresDropSignupStore {
  private readonly pool

  constructor(connectionString: string) {
    // One connection: a marketing form must never compete with checkout or publishing for the
    // database, and a signup is a single short statement.
    this.pool = createPostgresPool(connectionString, 1)
  }

  /**
   * The admin limiter's statement, on a public table.
   *
   * Copied rather than imported: the admin store's only pool comes from getAdminDatabase, which
   * throws unless ADMIN_LIBRARY_ENABLED — a flag that defaults to false and is explicitly false in
   * the browser fixtures. A public path may not depend on the admin library being switched on.
   *
   * The reasoning matters as much as the text. It is one atomic statement, so the "N concurrent
   * calls, exactly `limit` allowed" property holds with no transaction; cleanup runs only under a
   * try-lock and skips locked rows; the window is fixed rather than sliding; and the trailing
   * `where` means a blocked caller returns no row and so CANNOT extend its own lockout by hammering.
   */
  async allowRequest(subject: string, limit: number): Promise<boolean> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid public request limit")
    const key = createHash("sha256").update(`drop-signup:${subject}`).digest("hex")
    const result = await this.pool.query(
      `with cleanup_lock as (
         select pg_try_advisory_xact_lock(hashtextextended('public-request-attempt-cleanup', 0)) as acquired
       ), expired as (
         select subject_hash from commerce.public_request_attempts
         where window_start < now() - interval '1 day' and subject_hash <> $1
           and (select acquired from cleanup_lock)
         order by window_start limit 100 for update skip locked
       ), cleaned as (
         delete from commerce.public_request_attempts attempts using expired
         where attempts.subject_hash = expired.subject_hash
       )
       insert into commerce.public_request_attempts(subject_hash, window_start, attempts)
       values ($1, now(), 1)
       on conflict (subject_hash) do update set
         window_start = case when public_request_attempts.window_start < now() - interval '15 minutes' then now() else public_request_attempts.window_start end,
         attempts = case when public_request_attempts.window_start < now() - interval '15 minutes' then 1 else public_request_attempts.attempts + 1 end
       where public_request_attempts.window_start < now() - interval '15 minutes' or public_request_attempts.attempts < $2
       returning subject_hash`,
      [key, limit]
    )
    return result.rowCount === 1
  }

  /**
   * Record a subscriber, or refresh the consent of one who is already here.
   *
   * Signing up again is ordinary, not an error: it refreshes when they agreed and what they were
   * shown, and lifts an earlier unsubscribe. The lifted moment moves to last_unsubscribed_at and the
   * row is never deleted, so "they once said no" outlives them saying yes again.
   */
  async subscribe(email: string, source: string, signupIp: string | null): Promise<void> {
    await this.pool.query(
      `insert into commerce.drop_subscribers (email, source, consent_copy_version, signup_ip)
         values ($1, $2, $3, $4::inet)
       on conflict (email) do update set
         source = excluded.source,
         consent_copy_version = excluded.consent_copy_version,
         consented_at = now(),
         -- Keep the earlier address when this signup has none, so a local or preview submission
         -- cannot erase real evidence.
         signup_ip = coalesce(excluded.signup_ip, drop_subscribers.signup_ip),
         -- Every SET expression sees the OLD row, so this copies the unsubscribe the next line lifts.
         -- The coalesce keeps an earlier one through a second re-signup, which has nothing to copy.
         last_unsubscribed_at = coalesce(drop_subscribers.unsubscribed_at, drop_subscribers.last_unsubscribed_at),
         unsubscribed_at = null,
         updated_at = now()`,
      [email, source, dropConsentCopy.version, signupIp]
    )
  }

  /**
   * Stop emailing someone, by the subscriber id their unsubscribe link carries.
   *
   * Recorded, never deleted, as the privacy page says. A second click changes nothing, so the first
   * unsubscribe keeps its time.
   */
  async unsubscribe(id: string): Promise<void> {
    await this.pool.query(
      `update commerce.drop_subscribers set unsubscribed_at = now(), updated_at = now()
        where id = $1 and unsubscribed_at is null`,
      [id]
    )
  }

  /** Whether that link's subscriber has already left. An id that matches nobody reads as not. */
  async isUnsubscribed(id: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ unsubscribed: boolean }>(
      "select unsubscribed_at is not null as unsubscribed from commerce.drop_subscribers where id = $1",
      [id]
    )
    return rows[0]?.unsubscribed ?? false
  }

  close() {
    return this.pool.end()
  }
}
