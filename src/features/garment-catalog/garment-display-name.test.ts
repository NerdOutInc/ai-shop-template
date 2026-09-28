import { describe, expect, it } from "vitest"

import { garmentDisplayName } from "./garment-display-name"

describe("garmentDisplayName", () => {
  it("joins the manufacturer and model the owner gave it", () => {
    expect(garmentDisplayName({ blueprintId: 1317, manufacturer: "Next Level", model: "6210" })).toBe("Next Level 6210")
  })

  // A blueprint found on published products has no row, so it has no name to show yet.
  it.each([
    [null, null],
    ["", "  "],
  ])("falls back to the blueprint number when nothing is named (%j, %j)", (manufacturer, model) => {
    expect(garmentDisplayName({ blueprintId: 9999, manufacturer, model })).toBe("Blueprint 9999")
  })

  it("uses whichever half exists rather than printing a stray space", () => {
    expect(garmentDisplayName({ blueprintId: 12, manufacturer: " Bella+Canvas ", model: null })).toBe("Bella+Canvas")
  })
})
