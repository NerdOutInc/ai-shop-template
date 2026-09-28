import "server-only"
import { env } from "@/lib/env"
import { PostgresPublishingStore } from "./postgres-publishing-store.server"

let store: PostgresPublishingStore | undefined
export function getPublishingStore() {
  if (!env.DATABASE_URL || !env.PRINTIFY_SHOP_ID) throw new Error("Publishing storage is not configured")
  store ??= new PostgresPublishingStore(env.DATABASE_URL, env.PRINTIFY_SHOP_ID)
  return store
}
