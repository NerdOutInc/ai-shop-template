import { describe, expect, it } from "vitest"

import { garmentProfileOptions } from "./garment-profile-options"
import { garmentSetupSchema } from "./garment-setup-schema"

const complete = {
  manufacturer: "Next Level",
  model: "6210",
  categorySlug: "t-shirts",
  googleProductCategory: 212,
  gender: "unisex",
  ageGroup: "adult",
  sizeSystem: "US",
}

describe("garmentSetupSchema", () => {
  it("accepts a fully set up garment unchanged", () => {
    expect(garmentSetupSchema.parse(complete)).toEqual(complete)
  })

  // Adding a garment ahead of time saves its name first; the rest arrives when the owner decides.
  it("accepts a named garment with nothing else chosen yet", () => {
    const named = {
      ...complete,
      categorySlug: null,
      googleProductCategory: null,
      gender: null,
      ageGroup: null,
      sizeSystem: null,
    }
    expect(garmentSetupSchema.parse(named)).toEqual(named)
  })

  it("trims the manufacturer and model, which the table refuses padded", () => {
    expect(garmentSetupSchema.parse({ ...complete, manufacturer: "  Next Level ", model: " 6210\n" })).toMatchObject({
      manufacturer: "Next Level",
      model: "6210",
    })
  })

  // A client that forgets a key must not be able to clear that field by accident.
  it.each(Object.keys(complete))("refuses a body that leaves out %s instead of reading it as unset", (key) => {
    const body: Record<string, unknown> = { ...complete }
    delete body[key]
    expect(garmentSetupSchema.safeParse(body).success).toBe(false)
  })

  it.each([["complete"], ["blueprintId"], ["shopId"], ["category_slug"]])(
    "refuses a body that also carries %s",
    (key) => {
      expect(garmentSetupSchema.safeParse({ ...complete, [key]: true }).success).toBe(false)
    }
  )

  it.each([
    ["a blank manufacturer", { manufacturer: "   " }],
    ["a null manufacturer", { manufacturer: null }],
    ["an 81-character manufacturer", { manufacturer: "a".repeat(81) }],
    ["a blank model", { model: "" }],
    ["a null model", { model: null }],
    ["an 81-character model", { model: "a".repeat(81) }],
    // Built from code points so no raw control character sits in this file. Postgres cannot store
    // U+0000 and trim() keeps it, so only the schema can turn these into a 400.
    ["U+0000 inside the manufacturer", { manufacturer: `Next${String.fromCharCode(0)}Level` }],
    ["a trailing U+0000 on the manufacturer", { manufacturer: `Next Level${String.fromCharCode(0)}` }],
    ["a line break inside the manufacturer", { manufacturer: "Next\nLevel" }],
    ["U+0000 inside the model", { model: `62${String.fromCharCode(0)}10` }],
    ["a leading U+0000 on the model", { model: `${String.fromCharCode(0)}6210` }],
    ["a tab inside the model", { model: "62\t10" }],
    ["an empty category slug", { categorySlug: "" }],
    ["a category name where its slug belongs", { categorySlug: "T-shirts" }],
    ["a slug with a trailing dash", { categorySlug: "t-shirts-" }],
    ["a slug with a doubled dash", { categorySlug: "t--shirts" }],
    ["a slug followed by a newline", { categorySlug: "t-shirts\n" }],
    ["a 65-character slug", { categorySlug: "a".repeat(65) }],
    ["a zero Google category", { googleProductCategory: 0 }],
    ["a negative Google category", { googleProductCategory: -212 }],
    ["a fractional Google category", { googleProductCategory: 212.5 }],
    ["a seven-digit Google category", { googleProductCategory: 1_000_000 }],
    ["a Google category sent as text", { googleProductCategory: "212" }],
    ["a gender outside the feed's list", { gender: "women" }],
    ["a capitalized gender", { gender: "Unisex" }],
    ["an age group outside the feed's list", { ageGroup: "teen" }],
    ["a lowercase size system", { sizeSystem: "us" }],
    ["an empty string where null means unset", { gender: "" }],
  ])("refuses %s", (_label, change) => {
    expect(garmentSetupSchema.safeParse({ ...complete, ...change }).success).toBe(false)
  })

  it("accepts the boundaries: 80 characters, a 64-character slug and a six-digit category", () => {
    const edge = {
      ...complete,
      manufacturer: "a".repeat(80),
      model: "b".repeat(80),
      categorySlug: "c".repeat(64),
      googleProductCategory: 999_999,
    }
    expect(garmentSetupSchema.parse(edge)).toEqual(edge)
  })

  // The closed sets live in garmentProfileOptions and the table's checks mirror them. If the schema
  // ever drifts to its own list, a value the form offers starts bouncing as a 400.
  it("accepts every value the profile options offer", () => {
    for (const gender of garmentProfileOptions.genders)
      expect(garmentSetupSchema.safeParse({ ...complete, gender }).success).toBe(true)
    for (const ageGroup of garmentProfileOptions.ageGroups)
      expect(garmentSetupSchema.safeParse({ ...complete, ageGroup }).success).toBe(true)
    for (const sizeSystem of garmentProfileOptions.sizeSystems)
      expect(garmentSetupSchema.safeParse({ ...complete, sizeSystem }).success).toBe(true)
  })

  it.each([[null], [undefined], ["1317"], [[complete]]])("refuses a body of %j", (body) => {
    expect(garmentSetupSchema.safeParse(body).success).toBe(false)
  })
})
