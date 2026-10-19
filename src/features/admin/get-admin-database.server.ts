import "server-only"

import type { Pool } from "pg"
import { getSharedPostgresPool } from "@/lib/get-shared-postgres-pool.server"
import { env } from "@/lib/env"

let database: Pool | undefined

export function getAdminDatabase(): Pool {
  if (!env.ADMIN_LIBRARY_ENABLED || !env.DATABASE_URL) throw new Error("Admin library database is not configured")
  database ??= getSharedPostgresPool(env.DATABASE_URL, "admin")
  return database
}
