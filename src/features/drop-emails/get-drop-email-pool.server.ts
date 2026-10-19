import "server-only"

import type { Pool } from "pg"

import { getSharedPostgresPool } from "@/lib/get-shared-postgres-pool.server"
import { env } from "@/lib/env"

let pool: Pool | undefined

/**
 * Two connections, apart from checkout's. The sender holds one for its whole run, because its lock is
 * a session lock, and the admin page must not queue behind a run for up to a minute.
 */
export function getDropEmailPool() {
  if (!env.DATABASE_URL) throw new Error("Drop emails are not configured")
  pool ??= getSharedPostgresPool(env.DATABASE_URL, "emails")
  return pool
}
