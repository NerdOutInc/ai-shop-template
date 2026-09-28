/** A calendar date under the same Intl rules used by storefront schedules. */
export function localCalendarDate(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value)
}
