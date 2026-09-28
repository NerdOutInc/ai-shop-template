import { describe, expect, it } from "vitest"
import { getShippingSchedule } from "./get-shipping-schedule"

describe("shipping business-day calendar", () => {
  it("starts the next business day and skips weekends and Labor Day", () => {
    expect(getShippingSchedule("2026-09-01T16:00:00Z", 10, new Date("2026-09-14T16:00:00Z"), "UTC")).toMatchObject({
      paidDate: "2026-09-01",
      today: "2026-09-14",
      alertDate: "2026-09-14",
      shipByDate: "2026-09-16",
      businessDaysElapsed: 8,
      isBusinessDay: true,
    })
  })
  it("uses Chicago dates across midnight and spring daylight saving", () => {
    expect(
      getShippingSchedule("2026-03-07T03:00:00Z", 2, new Date("2026-03-09T14:00:00Z"), "America/Chicago")
    ).toMatchObject({
      paidDate: "2026-03-06",
      alertDate: "2026-03-09",
      shipByDate: "2026-03-10",
      businessDaysElapsed: 1,
    })
  })
  it("excludes next year's New Year observed on December 31", () => {
    expect(getShippingSchedule("2027-12-30T18:00:00Z", 2, new Date("2027-12-31T18:00:00Z"), "UTC")).toMatchObject({
      shipByDate: "2028-01-04",
      businessDaysElapsed: 0,
      isBusinessDay: false,
    })
  })
  it("rejects a missing saved time zone rather than changing an order's deadline", () => {
    expect(() => getShippingSchedule("2026-09-01", 2, new Date(), "")).toThrow("Invalid shipping window")
  })
  it.each([0, 1, 31, 2.5, NaN])("rejects invalid handling window %s", (days) => {
    expect(() => getShippingSchedule("2026-09-01", days, new Date(), "UTC")).toThrow("Invalid shipping window")
  })
})
