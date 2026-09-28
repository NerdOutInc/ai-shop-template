import { describe, expect, it } from "vitest"

import { isNewProduct } from "./is-new-product"

const now = Date.parse("2026-09-20T12:00:00.000Z")
const twoWeeks = 14 * 24 * 60 * 60 * 1000
const addedAt = (ms: number) => ({ addedToShopAt: new Date(ms).toISOString() })

describe("isNewProduct", () => {
  it("counts a tee the owner just put up as new", () => {
    expect(isNewProduct(addedAt(now), now)).toBe(true)
  })

  it("keeps the badge right up to the last millisecond of the fourteenth day", () => {
    expect(isNewProduct(addedAt(now - twoWeeks + 1), now)).toBe(true)
  })

  // "Less than 14 full days", so the badge comes off at exactly two weeks, not a millisecond later.
  it("drops the badge at exactly fourteen days", () => {
    expect(isNewProduct(addedAt(now - twoWeeks), now)).toBe(false)
    expect(isNewProduct({ addedToShopAt: "2026-09-06T12:00:00.000Z" }, now)).toBe(false)
  })

  // The database clock stamps Show and the app server reads it, so a stamp can land a hair ahead.
  it("counts a stamp slightly ahead of the app clock as new", () => {
    expect(isNewProduct(addedAt(now + 250), now)).toBe(true)
  })

  it("is never new without an arrival", () => {
    expect(isNewProduct({ addedToShopAt: null }, now)).toBe(false)
  })

  it.each([[""], ["not-a-date"], ["2026-13-45T99:99:99Z"]])("is never new on the unusable arrival %j", (value) => {
    expect(isNewProduct({ addedToShopAt: value }, now)).toBe(false)
  })
})
