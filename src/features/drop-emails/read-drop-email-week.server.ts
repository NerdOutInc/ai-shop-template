import "server-only"

import { getPublishingStore } from "@/features/publishing/get-publishing-store.server"
import type { ProductWeek } from "@/features/publishing/product-schedule-entry"
import { resolveProductWeek } from "@/features/publishing/resolve-product-week"

/**
 * This week's drop, read fresh.
 *
 * Not readProductWeek: that one answers null when storage fails, which is right for a page and wrong
 * here, where "no drop this week" and "could not tell" must not look alike. It also caches.
 */
export async function readDropEmailWeek(now: number): Promise<ProductWeek | null> {
  return resolveProductWeek(await getPublishingStore().productSchedule.list(), now)
}
