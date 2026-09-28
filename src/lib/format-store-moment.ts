import { storeTimeZone } from "./store-time-zone"

/**
 * A moment as the store's own clock reads it.
 *
 * The locale and zone are fixed on purpose. A client component renders once on the server, in UTC,
 * and again in the browser: `toLocaleString(undefined)` gives those two renders different text, which
 * React reports as a hydration mismatch, and it shows an owner in another zone a different day than
 * the one the moment actually lands on.
 */
export function formatStoreMoment(value: string | number | Date, options: Intl.DateTimeFormatOptions) {
  return new Date(value).toLocaleString("en-US", { ...options, timeZone: storeTimeZone })
}
