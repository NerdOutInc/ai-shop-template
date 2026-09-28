import "server-only"

import { revalidateTag } from "next/cache"

import { getPublishingStore } from "@/features/publishing/get-publishing-store.server"
import { env } from "@/lib/env"

import { fetchCatalogPopularity } from "./fetch-catalog-popularity.server"
import { fetchCatalogStock } from "./fetch-catalog-stock.server"
import { getCatalogSyncStore } from "./get-catalog-sync-store.server"

export async function refreshCatalog(kind: "stock" | "popularity", options: { force?: boolean } = {}) {
  const apiToken = env.PRINTIFY_API_TOKEN?.trim()
  const shopId = env.PRINTIFY_SHOP_ID
  if (!env.PRINTIFY_PUBLISHING_ENABLED || !apiToken || /[\r\n]/.test(apiToken) || !shopId || !/^[1-9]\d*$/.test(shopId))
    throw new Error("CATALOG_REFRESH_NOT_CONFIGURED")
  const result = await getCatalogSyncStore().refresh(
    kind,
    async () => {
      // Read uncached membership; polling never changes publication or imports saved draft display fields.
      const ids = await getPublishingStore().listProductIds()
      if (kind === "stock") return fetchCatalogStock({ apiToken, shopId }, ids)
      return ids.length ? fetchCatalogPopularity(apiToken, shopId, ids) : {}
    },
    options
  )
  // A retry may find the committed observation after the previous invocation missed invalidation.
  if (result === "updated" || result === "recent") revalidateTag(`catalog-observation-${kind}`, { expire: 0 })
  return result
}
