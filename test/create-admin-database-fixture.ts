import { Pool } from "pg"

/** Supabase's identity schema contract for isolated Postgres CI, never an application migration. */
export async function createAdminDatabaseFixture(connectionString: string) {
  const url = new URL(connectionString)
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    ![
      "/store_template_test",
      "/store_commerce_test",
      "/store_capacity_test",
      "/store_catalog_test",
      "/store_catalog_e2e",
      "/store_publishing_test",
      "/store_publishing_e2e",
      "/store_signup_test",
      "/store_admin_test",
      "/store_library_test",
      "/store_agent_test",
      "/store_drafts_test",
      "/store_garments_test",
      "/store_admin_e2e",
      "/store_orders_test",
      "/store_shipping_test",
      "/store_drop_email_test",
      "/store_drop_email_overview_test",
    ].includes(url.pathname)
  ) {
    throw new Error("Admin tests require an isolated local store_* test database")
  }
  const pool = new Pool({ connectionString })
  try {
    // Roles belong to the whole cluster, and every suite that uses this fixture runs it at once. A role
    // that already exists raises duplicate_object; one another suite is creating at this very instant
    // is not visible yet, so the loser is told by the catalog's unique index instead (unique_violation on
    // pg_authid_rolname_index) and its whole suite reports as skipped. That only happens while the roles
    // do not exist, which is every fresh cluster, which is every CI run. test/apply-all-migrations.ts
    // catches both for store_app_runtime for the same reason.
    await pool.query(`
      DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$;
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE IF NOT EXISTS auth.users (
        id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz,
        is_anonymous boolean NOT NULL DEFAULT false, banned_until timestamptz
      );
      CREATE TABLE IF NOT EXISTS auth.sessions (
        id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id), not_after timestamptz
      );
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
    `)
    return pool
  } catch (error) {
    await pool.end()
    throw error
  }
}
