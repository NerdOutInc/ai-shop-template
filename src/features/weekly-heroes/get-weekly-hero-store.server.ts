import "server-only"
import { getPublishingStore } from "@/features/publishing/get-publishing-store.server"
import { storeConfig } from "@/lib/store-config"
import { env } from "@/lib/env"

export function getWeeklyHeroStore() {
  if (
    !storeConfig.features.designOfTheWeek ||
    !env.DATABASE_URL ||
    !env.PRINTIFY_SHOP_ID ||
    !env.PRINTIFY_PUBLISHING_ENABLED
  )
    throw new Error("Weekly hero storage is not configured")
  return getPublishingStore().weeklyHeroes
}
