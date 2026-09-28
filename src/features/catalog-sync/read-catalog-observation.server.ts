import "server-only"

import { createHash } from "node:crypto"
import { unstable_cache } from "next/cache"

import { env } from "@/lib/env"

import { getCatalogSyncStore } from "./get-catalog-sync-store.server"

export async function readCatalogObservation(kind: "stock" | "popularity") {
  const { DATABASE_URL: databaseUrl, PRINTIFY_SHOP_ID: shopId } = env
  if (!databaseUrl || !shopId) throw new Error("Catalog storage is not configured")
  return unstable_cache(
    async () => {
      try {
        const observation = await getCatalogSyncStore().read(kind)
        // Next serializes cached values as JSON; keep the original observation time as a number.
        return observation ? { payload: observation.payload, observedAt: observation.observed_at.getTime() } : null
      } catch {
        // Failed revalidation must preserve the previous value without logging database credentials.
        throw new Error("Catalog observation unavailable")
      }
    },
    ["catalog-observation-v1", kind, shopId, createHash("sha256").update(databaseUrl).digest("hex")],
    { revalidate: 300, tags: [`catalog-observation-${kind}`] }
  )()
}
