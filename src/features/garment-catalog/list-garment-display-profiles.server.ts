import "server-only"

import { createHash } from "node:crypto"

import { unstable_cache } from "next/cache"

import { getPublishingStore } from "@/features/publishing/get-publishing-store.server"
import { env } from "@/lib/env"

import type { GarmentDisplayProfile } from "./garment-catalog"

/** A missing label must not take a published product or its available variants out of the shop. */
export async function listGarmentDisplayProfiles(): Promise<ReadonlyMap<number, GarmentDisplayProfile> | null> {
  try {
    const { DATABASE_URL: databaseUrl, PRINTIFY_SHOP_ID: shopId } = env
    if (!databaseUrl || !shopId) throw new Error("Published catalog is not configured")
    const read = unstable_cache(
      async () => {
        try {
          // The data cache serializes JSON; a Map would lose every saved profile.
          return [...(await getPublishingStore().garments.listDisplayProfiles())]
        } catch {
          // Reject failed fills so revalidation retains good labels without logging database details.
          throw new Error("Product garment profiles unavailable")
        }
      },
      ["garment-display-profiles-v2", shopId, createHash("sha256").update(databaseUrl).digest("hex")],
      { revalidate: 300, tags: ["printify-published-catalog"] }
    )
    return new Map(await read())
  } catch {
    console.warn("Product garment profiles unavailable", { reason: "storage" })
    return null
  }
}
