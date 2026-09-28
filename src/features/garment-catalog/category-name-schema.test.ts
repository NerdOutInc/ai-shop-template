import { describe, expect, it } from "vitest"

import { categoryNameSchema } from "./category-name-schema"

describe("categoryNameSchema", () => {
  // The table refuses a padded name, so the trimmed spelling is the one that must be stored.
  it("hands back the trimmed name", () => {
    expect(categoryNameSchema.parse("  Crop tops\n")).toBe("Crop tops")
  })

  it("accepts a name of exactly 60 characters and refuses 61", () => {
    expect(categoryNameSchema.safeParse("a".repeat(60)).success).toBe(true)
    expect(categoryNameSchema.safeParse("a".repeat(61)).success).toBe(false)
  })

  it("measures the name after trimming, not before", () => {
    expect(categoryNameSchema.safeParse(`  ${"a".repeat(60)}  `).success).toBe(true)
  })

  // Built from code points so no raw control character sits in this file. Postgres refuses U+0000
  // outright, and trim() keeps it, so the schema is the only place this can become a 400.
  it.each([
    ["U+0000 inside the name", `Hood${String.fromCharCode(0)}ies`],
    ["a leading U+0000", `${String.fromCharCode(0)}Hoodies`],
    ["a trailing U+0000", `Hoodies${String.fromCharCode(0)}`],
    ["a tab inside the name", "Crop\ttops"],
    ["a line break inside the name", "Crop\ntops"],
    ["an escape character", `Crop${String.fromCharCode(27)}tops`],
    ["a C1 control character", `Crop${String.fromCharCode(0x85)}tops`],
  ])("refuses %s", (_label, value) => {
    expect(categoryNameSchema.safeParse(value).success).toBe(false)
  })

  it("keeps the punctuation and accents a real name uses", () => {
    expect(categoryNameSchema.parse("Kids' tees & café crops")).toBe("Kids' tees & café crops")
  })

  it.each([[""], ["   "], [null], [undefined], [42], [["T-shirts"]]])("refuses %j", (value) => {
    expect(categoryNameSchema.safeParse(value).success).toBe(false)
  })
})
