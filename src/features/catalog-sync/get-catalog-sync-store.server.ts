import "server-only"

import { getSharedPostgresPool } from "@/lib/get-shared-postgres-pool.server"
import { env } from "@/lib/env"

import { PostgresCatalogSyncStore } from "./postgres-catalog-sync-store.server"

let store: PostgresCatalogSyncStore | undefined
export function getCatalogSyncStore() {
  if (!env.DATABASE_URL || !env.PRINTIFY_SHOP_ID) throw new Error("Catalog storage is not configured")
  store ??= new PostgresCatalogSyncStore(env.DATABASE_URL, env.PRINTIFY_SHOP_ID, {
    requests: getSharedPostgresPool(env.DATABASE_URL, "requests"),
    worker: getSharedPostgresPool(env.DATABASE_URL, "catalog"),
  })
  return store
}
