import "server-only"

import { getSharedPostgresPool } from "@/lib/get-shared-postgres-pool.server"
import { env } from "@/lib/env"

import { PostgresDropSignupStore } from "./postgres-drop-signup-store.server"

let store: PostgresDropSignupStore | undefined

/** A public signup burst must not consume storefront or worker connections. */
export function getDropSignupStore() {
  if (!env.DATABASE_URL) throw new Error("Drop signups are not configured")
  store ??= new PostgresDropSignupStore(env.DATABASE_URL, getSharedPostgresPool(env.DATABASE_URL, "signups"))
  return store
}
