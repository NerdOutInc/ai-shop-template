import "server-only"

import { createHash } from "node:crypto"
import type { Pool } from "pg"

export class AdminStore {
  constructor(private readonly database: Pool) {}

  async isActiveMember(userId: string): Promise<boolean> {
    const result = await this.database.query<{ active: boolean }>(
      `select m.active from public.admin_memberships m join private.auth_user_identity u on u.id=m.user_id
       where m.user_id=$1::uuid and m.active and u.email_confirmed_at is not null
         and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now())`,
      [userId]
    )
    return result.rows[0]?.active === true
  }

  async setupStatus(): Promise<"available" | "claimed" | "recovery"> {
    const result = await this.database.query<{ has_admin: boolean; consumed: boolean }>(
      `select exists(select 1 from public.admin_memberships where active) as has_admin,
        consumed_at is not null as consumed from private.admin_setup_state where singleton = true`
    )
    const state = result.rows[0]
    if (!state) throw new Error("Admin setup migration is missing")
    return state.has_admin ? "claimed" : state.consumed ? "recovery" : "available"
  }

  async claimOwner(userId: string, expectedEmail: string): Promise<boolean> {
    const result = await this.database.query<{ claimed: boolean }>(
      "select private.claim_admin_owner($1::uuid, $2::text) as claimed",
      [userId, expectedEmail]
    )
    return result.rows[0]?.claimed === true
  }

  async allowAuthAttempt(subject: string, limit = 5): Promise<boolean> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid authentication attempt limit")
    const key = createHash("sha256").update(subject).digest("hex")
    const result = await this.database.query(
      `with cleanup_lock as (
         select pg_try_advisory_xact_lock(hashtextextended('admin-auth-attempt-cleanup', 0)) as acquired
       ), expired as (
         select subject_hash from private.admin_auth_attempts
         where window_start < now() - interval '1 day' and subject_hash <> $1
           and (select acquired from cleanup_lock)
         order by window_start limit 100 for update skip locked
       ), cleaned as (
         delete from private.admin_auth_attempts attempts using expired
         where attempts.subject_hash = expired.subject_hash
       )
       insert into private.admin_auth_attempts(subject_hash, window_start, attempts)
       values ($1, now(), 1)
       on conflict (subject_hash) do update set
         window_start = case when admin_auth_attempts.window_start < now() - interval '15 minutes' then now() else admin_auth_attempts.window_start end,
         attempts = case when admin_auth_attempts.window_start < now() - interval '15 minutes' then 1 else admin_auth_attempts.attempts + 1 end
       where admin_auth_attempts.window_start < now() - interval '15 minutes' or admin_auth_attempts.attempts < $2
       returning subject_hash`,
      [key, limit]
    )
    return result.rowCount === 1
  }
}
