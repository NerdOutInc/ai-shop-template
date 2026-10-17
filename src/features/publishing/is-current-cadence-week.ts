import { DOTW_CADENCE } from "./dotw-cadence"
import { listCadenceSlots } from "./list-cadence-slots"

export function isCurrentCadenceWeek(liveAt: string, now: number, cadence = DOTW_CADENCE) {
  const start = Date.parse(liveAt)
  if (!Number.isFinite(start) || start > now) return false
  const end = listCadenceSlots({ cadence, from: new Date(start), count: 1 })[0]
  return Boolean(end && now < end.getTime())
}
