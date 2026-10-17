import { isCurrentCadenceWeek } from "./is-current-cadence-week"
import type { ProductScheduleEntry, ProductWeek } from "./product-schedule-entry"

/** Resolve the clock outside the cache, including an empty week after a feature expires. */
export function resolveProductWeek(entries: readonly ProductScheduleEntry[], now: number): ProductWeek | null {
  const current = entries.filter((entry) => Date.parse(entry.liveAt) <= now)
  const latest = current.reduce<string | null>(
    (value, entry) => (value === null || Date.parse(entry.liveAt) > Date.parse(value) ? entry.liveAt : value),
    null
  )
  if (!latest || !isCurrentCadenceWeek(latest, now)) return null
  return {
    liveAt: latest,
    productIds: current
      .filter((entry) => Date.parse(entry.liveAt) === Date.parse(latest))
      .map((entry) => entry.productId),
  }
}
