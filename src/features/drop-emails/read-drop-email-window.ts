import { listCadenceSlots } from "@/features/publishing/list-cadence-slots"
import { instantForLocalTime } from "@/lib/instant-for-local-time"
import { storeTimeZone } from "@/lib/store-time-zone"

const sendHour = 9
// Long enough for the cron to work through a few thousand subscribers, however late the drop lands.
const minimumWindowMs = 12 * 60 * 60_000
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const storeDay = (instant: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: storeTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant)

/**
 * When a drop's email goes out: 9 AM store time on the drop's own day, or at the drop itself if it
 * lands later than that. A weekly feature can go live before anyone is awake; its email should not.
 *
 * First attempts close at the end of that day, or twelve hours after the send time when a drop lands
 * late in the evening, so even a drop at 11:55 PM gets a full run of the cron. A drop whose window
 * passed without an email (sending was off, or the database was down all day) stays unannounced rather
 * than arriving days late, and that is also what stops switching the sender on mid-week from mailing a
 * catch-up nobody asked for.
 */
export function readDropEmailWindow(liveAt: string, now: number) {
  const live = new Date(liveAt)
  const weekday = weekdays.indexOf(
    new Intl.DateTimeFormat("en-US", { timeZone: storeTimeZone, weekday: "short" }).format(live)
  )
  // Solved from the zone's wall clock, so 9 AM holds across daylight-saving changes.
  const [nine] = listCadenceSlots({
    from: new Date(live.getTime() - 1),
    count: 1,
    cadence: { weekday, hour: sendHour, minute: 0, timeZone: storeTimeZone },
  })
  // A drop after 9 AM finds next week's 9 AM here, so the drop itself is the moment.
  const sendAt = nine && storeDay(nine) === storeDay(live) ? nine : live
  const [year, month, day] = storeDay(live).split("-").map(Number)
  const nextDay = new Date(Date.UTC(year!, month! - 1, day! + 1))
  const midnight = instantForLocalTime(
    nextDay.getUTCFullYear(),
    nextDay.getUTCMonth(),
    nextDay.getUTCDate(),
    0,
    0,
    storeTimeZone
  )
  const closeAt = new Date(Math.max(midnight.getTime(), sendAt.getTime() + minimumWindowMs))
  const state: "early" | "open" | "closed" =
    now < sendAt.getTime() ? "early" : now < closeAt.getTime() ? "open" : "closed"
  return { sendAt, closeAt, state }
}
