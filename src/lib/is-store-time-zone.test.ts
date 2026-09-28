import { describe, expect, it } from "vitest"
import { isStoreTimeZone } from "./is-store-time-zone"

describe("store time zone validation", () => {
  it.each([
    "UTC",
    "America/Chicago",
    "America/Argentina/Buenos_Aires",
    "Asia/Kolkata",
    "US/Central",
    "Etc/UTC",
    "Etc/GMT",
  ])("accepts the unambiguous named zone %s", (timeZone) => {
    expect(isStoreTimeZone(timeZone)).toBe(true)
  })

  it.each(["+05:00", "-05:00", "+05", "-05", "+0500", "-0500", "+05:30", "+00:00", "-00:00"])(
    "rejects the numeric offset %s before JavaScript and PostgreSQL can interpret its sign differently",
    (timeZone) => {
      expect(isStoreTimeZone(timeZone)).toBe(false)
    }
  )

  it.each(["CST", "PST", "EST", "CET", "GMT", "EST5EDT", "Zulu"])(
    "requires an explicit named zone instead of the bare alias %s",
    (timeZone) => {
      expect(isStoreTimeZone(timeZone)).toBe(false)
    }
  )

  it.each(["", "America/Not_A_Zone", "UTC/Invalid", "/", "UTC+5", "Etc/GMT+5", "Etc/GMT-9"])(
    "rejects the invalid zone %j",
    (timeZone) => {
      expect(isStoreTimeZone(timeZone)).toBe(false)
    }
  )
})
