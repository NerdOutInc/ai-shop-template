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
export function instantForLocalTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
) {
  let utc = Date.UTC(year, month, day, hour, minute)
  // Two passes converge: guess, measure the offset actually in force there, correct, re-measure.
  for (let pass = 0; pass < 2; pass++)
    utc = Date.UTC(year, month, day, hour, minute) - zoneOffsetMinutes(new Date(utc), timeZone) * 60_000
  return new Date(utc)
}
