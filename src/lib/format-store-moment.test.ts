import { describe, expect, it, vi } from "vitest"

import { formatStoreMoment } from "./format-store-moment"

vi.mock("./store-time-zone", () => ({ storeTimeZone: "America/Chicago" }))

describe("formatStoreMoment", () => {
  // 03:00 UTC is still the evening before in Chicago. A label read off the server's clock, or the
  // viewer's, would name the wrong day.
  it("names the store's day, not the server's or the viewer's", () => {
    expect(formatStoreMoment("2026-09-20T03:00:00.000Z", { dateStyle: "medium" })).toBe("Sep 19, 2026")
  })

  it("reads the hour off the store's clock across daylight saving", () => {
    const hour = (value: string) => formatStoreMoment(value, { hour: "numeric", hour12: false })
    expect(hour("2026-07-03T09:00:00.000Z")).toBe("04")
    expect(hour("2026-12-04T10:00:00.000Z")).toBe("04")
  })
})
