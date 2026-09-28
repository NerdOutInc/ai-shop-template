import "server-only"

import { createHash } from "node:crypto"

import { unstable_cache } from "next/cache"

import { getPublishingStore } from "@/features/publishing/get-publishing-store.server"
import { storeConfig } from "@/lib/store-config"
import { env } from "@/lib/env"

import type { ProductWeek } from "@/features/publishing/product-schedule-entry"
import { resolveProductWeek } from "@/features/publishing/resolve-product-week"

/** Only commerce membership is cached. Arrival and expiry use the live request clock. */
export async function readProductWeek(): Promise<ProductWeek | null> {
  if (!storeConfig.features.designOfTheWeek) return null
  const { DATABASE_URL: databaseUrl, PRINTIFY_SHOP_ID: shopId } = env
  if (!databaseUrl || !shopId || !env.PRINTIFY_PUBLISHING_ENABLED) return null
  const read = unstable_cache(
    async () => {
      try {
        return await getPublishingStore().productSchedule.list()
      } catch {
        throw new Error("Product schedule unavailable")
      }
    },
    ["product-week-v1", shopId, createHash("sha256").update(databaseUrl).digest("hex")],
    { revalidate: 300, tags: ["printify-published-catalog"] }
  )
  try {
    return resolveProductWeek(await read(), Date.now())
  } catch {
    console.warn("Product schedule unavailable", { reason: "storage" })
    return null
  }
}
