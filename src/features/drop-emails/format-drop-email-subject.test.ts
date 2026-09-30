import { describe, expect, it } from "vitest"

import { formatDropEmailSubject } from "./format-drop-email-subject"

describe("formatDropEmailSubject", () => {
  it.each([
    [["Abstract Lines"], "New this week: Abstract Lines"],
    [["Abstract Lines", "Fern Study"], "New this week: Abstract Lines and Fern Study"],
    [
      ["Abstract Lines", "Fern Study", "Night Garden", "Morning Scene"],
      "New this week: Abstract Lines, Fern Study and 2 more",
    ],
  ])("names the drop %j", (names, subject) => {
    expect(formatDropEmailSubject(names)).toBe(subject)
  })

  it("falls back to a plain line rather than send a runaway subject", () => {
    expect(formatDropEmailSubject(["A".repeat(140)])).toBe("New designs this week")
    expect(formatDropEmailSubject([])).toBe("New designs this week")
  })
})
