import "server-only"

import { env } from "@/lib/env"

import { PostgresCatalogSyncStore } from "./postgres-catalog-sync-store.server"

let store: PostgresCatalogSyncStore | undefined
export function getCatalogSyncStore() {
  if (!env.DATABASE_URL || !env.PRINTIFY_SHOP_ID) throw new Error("Catalog storage is not configured")
  store ??= new PostgresCatalogSyncStore(env.DATABASE_URL, env.PRINTIFY_SHOP_ID)
  return store
}
