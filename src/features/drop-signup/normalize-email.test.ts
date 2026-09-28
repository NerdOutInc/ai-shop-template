import { describe, expect, it } from "vitest"

import { normalizeEmail } from "./normalize-email"

describe("normalizeEmail", () => {
  it("gives one spelling per address, so a second sign-up updates rather than duplicates", () => {
    expect(normalizeEmail("  Shopper@Example.COM ")).toBe("shopper@example.com")
  })

  // A plus address is a real, separate inbox the person chose; collapsing it merges two people who
  // deliberately kept themselves apart.
  it("keeps a plus address distinct from the one it was derived from", () => {
    expect(normalizeEmail("shopper+gear@example.com")).toBe("shopper+gear@example.com")
    expect(normalizeEmail("shopper+gear@example.com")).not.toBe(normalizeEmail("shopper@example.com"))
  })
})
