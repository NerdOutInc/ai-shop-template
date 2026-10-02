import "server-only"
import type { Pool, PoolClient } from "pg"

/** Aggregate health only; timestamps survive erasure without retaining recipient identifiers. */
export async function readSignupConfirmationBudget(pool: Pool | PoolClient) {
  const row = (
    await pool.query<{ accepted: number; saturated: boolean }>(`
    select (select count(*)::int from unnest(accepted_at) stamp where stamp > now() - interval '1 hour') as accepted,
      coalesce(blocked_at > now() - interval '1 hour', false) as saturated
    from commerce.drop_signup_confirmation_budget where singleton = true`)
  ).rows[0]
  return row ?? { accepted: 0, saturated: false }
}
