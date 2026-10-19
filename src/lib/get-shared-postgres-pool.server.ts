import "server-only"

import { createHash } from "node:crypto"
import type { Pool } from "pg"

import { createPostgresPool } from "./create-postgres-pool.server"
import { env } from "./env"

const budgets = {
  requests: 2,
  admin: 2,
  signups: 1,
  checkout: 4,
  admission: 1,
  publishing: 1,
  catalog: 2,
  emails: 2,
  alerts: 1,
} as const

export function getSharedPostgresPool(connectionString: string, purpose: keyof typeof budgets): Pool {
  // Next can bundle the same module into several routes. Share across those copies, but never
  // across processes, database credentials, or TLS trust settings. Long session locks have their
  // own budgets so a slow provider cannot consume the short-query pool. Library/agent transactions and
  // public signup bursts are isolated too. Registry pools live for the process; borrowers never end them.
  const runtime = globalThis as typeof globalThis & { storePostgresPools?: Map<string, Pool> }
  const pools = (runtime.storePostgresPools ??= new Map())
  // Include the budget across development reloads; keep credentials out of registry keys.
  const key = createHash("sha256")
    .update(JSON.stringify([connectionString, env.DATABASE_SSL_CA, purpose, budgets[purpose]]))
    .digest("hex")
  let pool = pools.get(key)
  if (!pool) {
    pool = createPostgresPool(connectionString, budgets[purpose], purpose)
    pools.set(key, pool)
  }
  return pool
}
