import "server-only"

import { storeConfig } from "@/lib/store-config"
import { getPublishingStore } from "@/features/publishing/get-publishing-store.server"

import type { ProductScheduleEntry } from "@/features/publishing/product-schedule-entry"
import { resolveProductWeek } from "@/features/publishing/resolve-product-week"

export type AdminProductSchedule =
  { status: "ready"; entries: ProductScheduleEntry[]; now: number } | { status: "unavailable" | "disabled" }

/** Called only after the admin route has authenticated; no cache can cross an admin session. */
export async function readAdminProductSchedule(): Promise<AdminProductSchedule> {
  if (!storeConfig.features.designOfTheWeek) return { status: "disabled" }
  try {
    const entries = await getPublishingStore().productSchedule.list()
    const now = Date.now()
    const current = resolveProductWeek(entries, now)
    return {
      status: "ready",
      entries: entries.filter((entry) => Date.parse(entry.liveAt) > now || entry.liveAt === current?.liveAt),
      now,
    }
  } catch {
    console.warn("Product schedule unavailable", { reason: "storage" })
    return { status: "unavailable" }
  }
}
