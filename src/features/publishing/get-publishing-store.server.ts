import "server-only"
import { getSharedPostgresPool } from "@/lib/get-shared-postgres-pool.server"
import { env } from "@/lib/env"
import { PostgresPublishingStore } from "./postgres-publishing-store.server"

let store: PostgresPublishingStore | undefined
export function getPublishingStore() {
  if (!env.DATABASE_URL || !env.PRINTIFY_SHOP_ID) throw new Error("Publishing storage is not configured")
  store ??= new PostgresPublishingStore(env.DATABASE_URL, env.PRINTIFY_SHOP_ID, {
    requests: getSharedPostgresPool(env.DATABASE_URL, "requests"),
    worker: getSharedPostgresPool(env.DATABASE_URL, "publishing"),
  })
  return store
}
