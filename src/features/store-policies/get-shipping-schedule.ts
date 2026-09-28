/** The calendar advertised at checkout: weekdays excluding observed US federal holidays. */
export function getShippingSchedule(paidAt: string, handlingDays: number, now: Date, timeZone: string) {
  if (
    !timeZone ||
    !Number.isInteger(handlingDays) ||
    handlingDays < 2 ||
    handlingDays > 30 ||
    !Number.isFinite(Date.parse(paidAt))
  )
    throw new Error("Invalid shipping window")
  const localDate = (value: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(value)
  const paidDate = localDate(new Date(paidAt))
  const today = localDate(now)
  const day = new Date(`${paidDate}T12:00:00Z`)
  let count = 0
  let businessDaysElapsed = 0
  let alertDate = ""
  let shipByDate = ""
  // Dates, rather than 24-hour durations, keep daylight-saving changes out of the count.
  while (count < handlingDays || day.toISOString().slice(0, 10) < today) {
    day.setUTCDate(day.getUTCDate() + 1)
    const date = day.toISOString().slice(0, 10)
    if (isBusinessDay(day)) {
      count++
      if (date <= today) businessDaysElapsed++
      if (count === Math.max(1, handlingDays - 2)) alertDate = date
      if (count === handlingDays) shipByDate = date
    }
  }
  return {
    paidDate,
    today,
    shipByDate,
    alertDate,
    businessDaysElapsed,
    isBusinessDay: isBusinessDay(new Date(`${today}T12:00:00Z`)),
  }
}

function isBusinessDay(date: Date) {
  if (date.getUTCDay() === 0 || date.getUTCDay() === 6) return false
  const year = date.getUTCFullYear()
  const iso = date.toISOString().slice(0, 10)
  const holidays = new Set<string>()
  const add = (value: Date) => holidays.add(value.toISOString().slice(0, 10))
  const observed = (year: number, month: number, day: number) => {
    const value = new Date(Date.UTC(year, month - 1, day, 12))
    if (value.getUTCDay() === 6) value.setUTCDate(value.getUTCDate() - 1)
    if (value.getUTCDay() === 0) value.setUTCDate(value.getUTCDate() + 1)
    add(value)
  }
  const nth = (month: number, weekday: number, occurrence: number) => {
    const value = new Date(Date.UTC(year, month - 1, 1, 12))
    value.setUTCDate(1 + ((weekday - value.getUTCDay() + 7) % 7) + 7 * (occurrence - 1))
    add(value)
  }
  observed(year, 1, 1)
  observed(year + 1, 1, 1) // January 1 can be observed on December 31 of this year.
  observed(year, 6, 19)
  observed(year, 7, 4)
  observed(year, 11, 11)
  observed(year, 12, 25)
  nth(1, 1, 3)
  nth(2, 1, 3)
  const memorial = new Date(Date.UTC(year, 4, 31, 12))
  memorial.setUTCDate(31 - ((memorial.getUTCDay() - 1 + 7) % 7))
  add(memorial)
  nth(9, 1, 1)
  nth(10, 1, 2)
  nth(11, 4, 4)
  return !holidays.has(iso)
}
