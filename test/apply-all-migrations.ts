import { readFile, readdir } from "node:fs/promises"
import type { Pool } from "pg"

/**
 * Apply one statement batch, retrying a shared-catalog write conflict.
 *
 * Roles, and the grants to them, are CLUSTER-wide. Nine suites each own their own database but share
 * one `pg_authid`, so two of them running `grant ... to store_app_runtime` in the same instant make one
 * fail with `tuple concurrently updated`. That is a catalog write conflict, not the `duplicate_object`
 * the existence checks below already absorb, so no exception list can catch it -- it surfaces as a
 * whole suite failing in `beforeAll`, which reads as a defect in the code under test and is not one.
 *
 * Retrying is safe rather than half-applied: a migration file is handed over as one multi-statement
 * query, which PostgreSQL wraps in a single implicit transaction, and no migration here contains its
 * own BEGIN or COMMIT. A conflicted file therefore rolls back whole.
 *
 * Production never meets this: `supabase db push` applies migrations to one database, in order.
 */
async function applySerializably(pool: Pool, sql: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      await pool.query(sql)
      return
    } catch (error) {
      const conflicted = error instanceof Error && error.message.includes("tuple concurrently updated")
      if (!conflicted || attempt >= 5) throw error
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)))
    }
  }
}

/** Rebuild the store's application schemas from every migration in filename order, as production applies them. */
export async function applyAllMigrations(pool: Pool) {
  await pool.query(
    "drop schema if exists commerce cascade; drop schema if exists private cascade; drop schema if exists public cascade; create schema public; grant usage on schema public to anon, authenticated, service_role"
  )
  // The application login is cluster-wide, so suites sharing one Postgres would race the migrations' existence checks.
  await applySerializably(
    pool,
    `do $$ begin
       create role store_app_runtime login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
     exception when duplicate_object or unique_violation then null; end $$`
  )
  for (const file of (await readdir("supabase/migrations")).filter((name) => name.endsWith(".sql")).sort())
    await applySerializably(pool, await readFile(`supabase/migrations/${file}`, "utf8"))
}
