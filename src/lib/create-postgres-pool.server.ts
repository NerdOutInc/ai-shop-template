import "server-only"

import { Pool } from "pg"

import { attachPostgresPoolLifecycle } from "./attach-postgres-pool-lifecycle.server"
import { env } from "./env"
import { postgresConnectionConfig } from "./postgres-connection-config.server"

export function createPostgresPool(connectionString: string, maxConnections = 3) {
  if (!Number.isInteger(maxConnections) || maxConnections < 1 || maxConnections > 3)
    throw new Error("Use a bounded Postgres connection pool")
  const pool = new Pool({
    ...postgresConnectionConfig(connectionString, env.DATABASE_SSL_CA),
    max: maxConnections,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 8_000,
    query_timeout: 10_000,
  })
  attachPostgresPoolLifecycle(pool)
  pool.on("error", () => console.error("Publishing database connection unavailable"))
  return pool
}
