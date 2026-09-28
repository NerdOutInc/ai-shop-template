import { describe, expect, it } from "vitest"

import { DOTW_CADENCE } from "./dotw-cadence"
import { listCadenceSlots } from "./list-cadence-slots"

// Intl punctuates differently across engines, so compare the parts rather than the sentence.
function localWallClock(instant: Date, timeZone: string = DOTW_CADENCE.timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(instant)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)!.value
  return `${value("weekday")} ${value("hour")}:${value("minute")}`
}

describe("listCadenceSlots", () => {
  it("offers the next four drops, always on the cadence weekday at the cadence hour", () => {
    const slots = listCadenceSlots({ from: new Date("2026-09-21T15:00:00.000Z") })
    expect(slots).toHaveLength(4)
    for (const slot of slots) expect(localWallClock(slot)).toBe("Fri 17:30")
    expect(slots.map((slot) => slot.getTime())).toEqual([...slots.map((slot) => slot.getTime())].toSorted())
  })

  // The whole reason this helper exists instead of inline arithmetic. The week containing the
  // November transition is 169 hours long, so adding 168 would move the drop to 03:00 local -- an
  // hour before anyone expects it, and before the owner is awake to see it land.
  it("keeps the local hour across a daylight-saving change, so the weeks are not all 168 hours apart", () => {
    const cadence = { weekday: 1, hour: 4, minute: 0, timeZone: "America/Chicago" }
    const slots = listCadenceSlots({ from: new Date("2026-10-23T15:00:00.000Z"), count: 4, cadence })
    for (const slot of slots) expect(localWallClock(slot, cadence.timeZone)).toBe("Mon 04:00")
    const gaps = slots.slice(1).map((slot, index) => slot.getTime() - slots[index]!.getTime())
    expect(gaps).toContain(169 * 60 * 60 * 1000)
    expect(gaps).not.toEqual(gaps.map(() => 168 * 60 * 60 * 1000))
  })

  it("never offers a moment that has already passed, including the cadence day itself", () => {
    // Friday 18:30 in Chicago: this week's slot is an hour gone, so use next Friday.
    const afterThisWeeksSlot = new Date("2026-09-25T23:30:00.000Z")
    const [first] = listCadenceSlots({ from: afterThisWeeksSlot, count: 1 })
    expect(first!.getTime()).toBeGreaterThan(afterThisWeeksSlot.getTime())
    expect(localWallClock(first!)).toBe("Fri 17:30")
    expect(first!.getTime() - afterThisWeeksSlot.getTime()).toBeGreaterThan(6 * 86_400_000)
  })

  it("skips a slot another drop already holds rather than offering a conflict", () => {
    const all = listCadenceSlots({ from: new Date("2026-09-21T15:00:00.000Z"), count: 4 })
    const withoutSecond = listCadenceSlots({
      from: new Date("2026-09-21T15:00:00.000Z"),
      count: 3,
      taken: [all[1]!.toISOString()],
    })
    expect(withoutSecond.map((slot) => slot.toISOString())).toEqual(
      [all[0]!, all[2]!, all[3]!].map((s) => s.toISOString())
    )
  })

  it("honours a different cadence without touching the stored dates of anything already queued", () => {
    const monday = { weekday: 1, hour: 9, minute: 0, timeZone: "UTC" }
    const slots = listCadenceSlots({ from: new Date("2026-09-21T15:00:00.000Z"), count: 2, cadence: monday })
    for (const slot of slots) {
      expect(localWallClock(slot, monday.timeZone)).toBe("Mon 09:00")
    }
  })
})
