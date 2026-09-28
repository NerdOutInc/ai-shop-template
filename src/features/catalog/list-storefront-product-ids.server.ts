import "server-only"

import { createHash } from "node:crypto"

import { unstable_cache } from "next/cache"

import { getPublishingStore } from "@/features/publishing/get-publishing-store.server"
import { hasRevealArrived } from "@/features/publishing/has-reveal-arrived"
import { env } from "@/lib/env"

export async function listStorefrontProductIds(): Promise<string[]> {
  const { DATABASE_URL: databaseUrl, PRINTIFY_SHOP_ID: shopId } = env
  if (!databaseUrl || !shopId) throw new Error("Published catalog is not configured")
  const read = unstable_cache(
    async () => {
      try {
        return await getPublishingStore().listRevealableProductIds()
      } catch {
        // Reject the cache fill: a database outage must not become an empty shop.
        throw new Error("Published catalog membership unavailable")
      }
    },
    ["published-catalog-membership-v1", shopId, createHash("sha256").update(databaseUrl).digest("hex")],
    { revalidate: 300, tags: ["printify-published-catalog"] }
  )
  // A scheduled reveal happens with no write, so nothing revalidates this tag when the moment
  // passes. The clock comparison has to sit outside the cache, against one time per request.
  const now = Date.now()
  return (await read()).filter((row) => hasRevealArrived(row, now)).map((row) => row.id)
}
