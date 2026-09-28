import { DOTW_CADENCE } from "./dotw-cadence"

/** Describe the configured wall clock, without borrowing a seasonal offset from a sample date. */
export function formatWeeklyCadence(cadence = DOTW_CADENCE) {
  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
  const hour = cadence.hour % 12 || 12
  const minute = String(cadence.minute).padStart(2, "0")
  const period = cadence.hour < 12 ? "AM" : "PM"
  return `${weekdays[cadence.weekday]} at ${hour}:${minute} ${period} (${cadence.timeZone})`
}
