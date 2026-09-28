import { DOTW_CADENCE } from "./dotw-cadence"

/** Minutes the named zone is offset from UTC at that instant, read from the zone's own rules. */
function zoneOffsetMinutes(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant)
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value)
  // Hour 24 is how en-US hourCycle h23 spells midnight in some engines.
  const hour = read("hour") % 24
  const asUtc = Date.UTC(read("year"), read("month") - 1, read("day"), hour, read("minute"), read("second"))
  return (asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000
}

/** The instant when the named zone's wall clock next reads this date and time. */
function instantForLocalTime(year: number, month: number, day: number, hour: number, minute: number, timeZone: string) {
  let utc = Date.UTC(year, month, day, hour, minute)
  // Two passes converge: guess, measure the offset actually in force there, correct, re-measure.
  for (let pass = 0; pass < 2; pass++)
    utc = Date.UTC(year, month, day, hour, minute) - zoneOffsetMinutes(new Date(utc), timeZone) * 60_000
  return new Date(utc)
}

/**
 * The next `count` cadence instants strictly after `from`, skipping any already taken.
 *
 * Each week is solved FRESH from the wall-clock rule rather than adding seven days to the previous
 * one. Across a daylight-saving boundary, `previous + 168h` lands the drop an hour early or late;
 * shoppers and the owner both read the local hour, so the local hour is what must hold.
 */
export function listCadenceSlots({
  from,
  count = 4,
  taken = [],
  cadence = DOTW_CADENCE,
}: {
  from: Date
  count?: number
  taken?: readonly string[]
  cadence?: { weekday: number; hour: number; minute: number; timeZone: string }
}): Date[] {
  const skip = new Set(taken.map((value) => new Date(value).getTime()))
  const slots: Date[] = []
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone: cadence.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  })
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  const parts = local.formatToParts(from)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)!.value
  const startDay = Date.UTC(Number(value("year")), Number(value("month")) - 1, Number(value("day")))
  const todayIndex = weekdays.indexOf(value("weekday"))
  let ahead = (cadence.weekday - todayIndex + 7) % 7

  // 60 weeks is far past any queue a weekly drop will hold; it only bounds a pathological cadence.
  for (let week = 0; slots.length < count && week < 60; week++, ahead += 7) {
    const day = new Date(startDay + ahead * 86_400_000)
    const slot = instantForLocalTime(
      day.getUTCFullYear(),
      day.getUTCMonth(),
      day.getUTCDate(),
      cadence.hour,
      cadence.minute,
      cadence.timeZone
    )
    if (slot.getTime() > from.getTime() && !skip.has(slot.getTime())) slots.push(slot)
  }
  return slots
}
