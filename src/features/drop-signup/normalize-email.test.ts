import { describe, expect, it } from "vitest"

import { normalizeEmail } from "./normalize-email"

describe("normalizeEmail", () => {
  it("gives one spelling per address, so a second sign-up updates rather than duplicates", () => {
    expect(normalizeEmail("  Climber@Example.COM ")).toBe("climber@example.com")
  })

  // A plus address is a real, separate inbox the person chose; collapsing it merges two people who
  // deliberately kept themselves apart.
  it("keeps a plus address distinct from the one it was derived from", () => {
    expect(normalizeEmail("climber+gear@example.com")).toBe("climber+gear@example.com")
    expect(normalizeEmail("climber+gear@example.com")).not.toBe(normalizeEmail("climber@example.com"))
  })
})
