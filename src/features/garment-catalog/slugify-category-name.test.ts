import { describe, expect, it } from "vitest"

import { slugifyCategoryName } from "./slugify-category-name"

// The check on commerce.shop_categories.slug. A slug that fails it is a 503 on create, not a 400.
const databasePattern = /^[a-z0-9]+(-[a-z0-9]+)*$/

describe("slugifyCategoryName", () => {
  it.each([
    ["T-shirts", "t-shirts"],
    ["Crop Tops", "crop-tops"],
    ["  Tank   tops  ", "tank-tops"],
    ["Hoodies & Sweatshirts", "hoodies-sweatshirts"],
    ["Kids' tees (2T–5T)", "kids-tees-2t-5t"],
    ["Café Crème", "cafe-creme"],
    ["ÅNGSTRÖM", "angstrom"],
    ["ﬁtted tees", "fitted-tees"],
    ["3/4 sleeve", "3-4-sleeve"],
    ["--already--dashed--", "already-dashed"],
  ])("turns %j into %j", (name, slug) => {
    expect(slugifyCategoryName(name)).toBe(slug)
    expect(slug).toMatch(databasePattern)
  })

  it.each([[""], ["   "], ["!!!"], ["—"], ["日本語"], ["🧗"]])(
    "returns null when nothing in %j can be spelled in a URL",
    (name) => {
      expect(slugifyCategoryName(name)).toBeNull()
    }
  )

  it("keeps the part of a mixed name it can spell", () => {
    expect(slugifyCategoryName("Tees 日本語")).toBe("tees")
  })

  it("stops at 64 characters", () => {
    const slug = slugifyCategoryName("a".repeat(100))
    expect(slug).toBe("a".repeat(64))
  })

  // Sixty-three letters then a space: the 64th character is the separator, and a slug ending in a
  // dash fails the database's pattern.
  it("never ends on a separator when the cut lands on one", () => {
    const slug = slugifyCategoryName(`${"a".repeat(63)} tees`)
    expect(slug).toBe("a".repeat(63))
    expect(slug).toMatch(databasePattern)
  })
})
