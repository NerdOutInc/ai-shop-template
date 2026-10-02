import "server-only"
import type { Pool } from "pg"

/** Lock before reading the paired arrays so cleanup cannot overwrite a concurrent admission. */
export async function pruneSignupConfirmationBudget(pool: Pool) {
  await pool.query(`with budget as (
    select singleton, accepted_at, subject_hashes from commerce.drop_signup_confirmation_budget
    where singleton = true for update
  ), recent as (
    select coalesce(array_agg(stamp), '{}'::timestamptz[]) as stamps,
      coalesce(array_agg(subject), '{}'::text[]) as subjects
    from budget, unnest(accepted_at, subject_hashes) as request(stamp, subject)
    where stamp > clock_timestamp() - interval '1 hour'
  )
  update commerce.drop_signup_confirmation_budget set accepted_at = recent.stamps, subject_hashes = recent.subjects
  from recent where singleton = true`)
  await pool.query(`with expired as (
    select subject_hash from commerce.public_request_attempts where window_start <= now() - interval '1 day'
    order by window_start limit 1000 for update skip locked
  ) delete from commerce.public_request_attempts attempts using expired where attempts.subject_hash=expired.subject_hash`)
}
