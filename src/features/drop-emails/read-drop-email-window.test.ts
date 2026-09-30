import { describe, expect, it } from "vitest"

import { readDropEmailWindow } from "./read-drop-email-window"

describe("readDropEmailWindow", () => {
  // Monday October 5, 2026 at 4 AM Central, daylight time (UTC-5).
  const liveAt = "2026-10-05T09:00:00.000Z"

  it("opens at 9 AM Central on the drop's day and closes at midnight Central", () => {
    expect(readDropEmailWindow(liveAt, Date.parse("2026-10-05T13:59:00Z"))).toEqual({
      sendAt: new Date("2026-10-05T14:00:00Z"),
      state: "early",
    })
    expect(readDropEmailWindow(liveAt, Date.parse("2026-10-05T14:00:00Z")).state).toBe("open")
    // 11:59 PM Central is still Monday; a minute later it is not.
    expect(readDropEmailWindow(liveAt, Date.parse("2026-10-06T04:59:00Z")).state).toBe("open")
    expect(readDropEmailWindow(liveAt, Date.parse("2026-10-06T05:00:00Z")).state).toBe("closed")
  })

  it("keeps 9 AM on the wall clock through a daylight-saving change", () => {
    // November 9, 2026 is standard time (UTC-6): 4 AM is 10:00 UTC and 9 AM is 15:00 UTC.
    expect(readDropEmailWindow("2026-11-09T10:00:00.000Z", Date.parse("2026-11-09T14:30:00Z"))).toEqual({
      sendAt: new Date("2026-11-09T15:00:00Z"),
      state: "early",
    })
  })

  it("sends at the drop itself when the drop lands after 9 AM", () => {
    expect(readDropEmailWindow("2026-10-05T16:00:00.000Z", Date.parse("2026-10-05T16:05:00Z"))).toEqual({
      sendAt: new Date("2026-10-05T16:00:00Z"),
      state: "open",
    })
  })
})
