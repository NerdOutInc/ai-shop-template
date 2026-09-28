import { describe, expect, it } from "vitest"

import { hasRevealArrived } from "./has-reveal-arrived"

const now = Date.parse("2026-09-20T12:00:00.000Z")

describe("hasRevealArrived", () => {
  it("shows a product that is not waiting for a reveal", () => {
    expect(hasRevealArrived({ revealAt: null }, now)).toBe(true)
  })

  it("shows a product once its moment has passed, including the moment itself", () => {
    expect(hasRevealArrived({ revealAt: "2026-09-20T11:59:59.999Z" }, now)).toBe(true)
    expect(hasRevealArrived({ revealAt: "2026-09-20T12:00:00.000Z" }, now)).toBe(true)
  })

  it("withholds a product whose moment has not arrived", () => {
    expect(hasRevealArrived({ revealAt: "2026-09-20T12:00:00.001Z" }, now)).toBe(false)
  })

  it.each([["" as const], ["not-a-date" as const], ["2026-13-45T99:99:99Z" as const]])(
    "fails closed on the unusable moment %j",
    (revealAt) => {
      expect(hasRevealArrived({ revealAt }, now)).toBe(false)
    }
  )

  it("fails closed when the field is absent entirely", () => {
    expect(hasRevealArrived({ revealAt: undefined } as unknown as { revealAt: string | null }, now)).toBe(false)
  })
})
