import "server-only"

import { env } from "@/lib/env"

import { PostgresDropSignupStore } from "./postgres-drop-signup-store.server"

let store: PostgresDropSignupStore | undefined

/** One store per process, so the form holds one connection rather than one per request. */
export function getDropSignupStore() {
  if (!env.DATABASE_URL) throw new Error("Drop signups are not configured")
  store ??= new PostgresDropSignupStore(env.DATABASE_URL)
  return store
}
