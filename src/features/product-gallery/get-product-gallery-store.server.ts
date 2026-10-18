import "server-only"
import { getPublishingStore } from "@/features/publishing/get-publishing-store.server"
import { env } from "@/lib/env"
export function getProductGalleryStore() {
  if (!env.PRINTIFY_PUBLISHING_ENABLED || !env.DATABASE_URL || !env.PRINTIFY_SHOP_ID)
    throw new Error("Gallery storage unavailable")
  return getPublishingStore().galleries
}
