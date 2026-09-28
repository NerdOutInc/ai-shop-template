import { expect, it, vi } from "vitest"

import { formatWeeklyCadence } from "./format-weekly-cadence"

vi.mock("./dotw-cadence", () => ({
  DOTW_CADENCE: { weekday: 5, hour: 17, minute: 45, timeZone: "Asia/Tokyo" },
}))

it("defaults to the same configured cadence used to generate release slots", () => {
  expect(formatWeeklyCadence()).toBe("Friday at 5:45 PM (Asia/Tokyo)")
})

it.each([
  [{ weekday: 1, hour: 9, minute: 0, timeZone: "UTC" }, "Monday at 9:00 AM (UTC)"],
  [{ weekday: 0, hour: 0, minute: 5, timeZone: "America/Chicago" }, "Sunday at 12:05 AM (America/Chicago)"],
  [{ weekday: 6, hour: 12, minute: 30, timeZone: "Asia/Kathmandu" }, "Saturday at 12:30 PM (Asia/Kathmandu)"],
  [{ weekday: 3, hour: 23, minute: 59, timeZone: "Pacific/Auckland" }, "Wednesday at 11:59 PM (Pacific/Auckland)"],
])("describes the local weekday, clock time and named zone", (cadence, expected) => {
  expect(formatWeeklyCadence(cadence)).toBe(expected)
})
