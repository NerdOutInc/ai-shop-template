import { Pool } from "pg"

/**
 * Connect as the store's restricted application login so tests exercise its real privileges and policies.
 *
 * Every suite that calls this has its own database but shares one `pg_authid` row for the login, and
 * vitest runs them at once. Two ALTERs in the same instant make the loser fail with `tuple concurrently
 * updated`, its `beforeAll` throws, and the whole suite reports as skipped. It is the conflict
 * `applySerializably` in ./apply-all-migrations.ts absorbs, met here by a statement that file never runs.
 *
 * Retrying is bounded, not hopeful: a conflict means another caller's ALTER just committed, and each
 * caller commits one, so a call can lose at most once per other caller. The budget below is several
 * times the callers there are. An advisory lock cannot serialize them instead; those are per-database.
 */
export async function createRuntimeLoginPool(superuser: Pool, connectionString: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      await superuser.query("alter role store_app_runtime with login password 'runtime-fixture'")
      break
    } catch (error) {
      const conflicted = error instanceof Error && error.message.includes("tuple concurrently updated")
      if (!conflicted || attempt >= 15) throw error
      // Losers of one conflict all come back together, so spread them out or they only collide again:
      // six evenly spaced attempts held for four callers and failed half the time for eight.
      await new Promise((resolve) => setTimeout(resolve, 10 + Math.random() * 25 * (attempt + 1)))
    }
  }
  const url = new URL(connectionString)
  url.username = "store_app_runtime"
  url.password = "runtime-fixture"
  return new Pool({ connectionString: url.toString() })
}
