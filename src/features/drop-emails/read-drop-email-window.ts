import { listCadenceSlots } from "@/features/publishing/list-cadence-slots"
import { storeTimeZone } from "@/lib/store-time-zone"

const sendHour = 9
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
 * The window closes at the end of that day. A drop whose day passed without an email (sending was
 * off, or the database was down all day) stays unannounced rather than arriving days late, and that
 * is also what stops switching the sender on mid-week from mailing a catch-up nobody asked for.
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
  const state: "early" | "open" | "closed" =
    now < sendAt.getTime() ? "early" : storeDay(new Date(now)) === storeDay(live) ? "open" : "closed"
  return { sendAt, state }
}
