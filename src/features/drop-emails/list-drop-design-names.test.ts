import { describe, expect, it } from "vitest"

import { listDropDesignNames } from "./list-drop-design-names"

describe("listDropDesignNames", () => {
  it("names a design once however many garments it comes on, in roster order", () => {
    expect(
      listDropDesignNames([
        "Abstract Lines - Premium T-Shirt",
        "Morning Scene - Premium T-Shirt",
        "Abstract Lines - Festival Crop Top",
      ])
    ).toEqual(["Abstract Lines", "Morning Scene"])
  })

  // Printify garments carry hyphens of their own; only a spaced dash separates the garment.
  it.each([
    ["Salt, Sun and Vinyl - Women's Organic Mid-Weight Hoodie", "Salt, Sun and Vinyl"],
    ["Late Night Radio – The Concert Tank", "Late Night Radio"],
    ["Well-Read — Premium T-Shirt", "Well-Read"],
    ["A Title Without a Garment", "A Title Without a Garment"],
  ])("reads %s as %s", (title, name) => {
    expect(listDropDesignNames([title])).toEqual([name])
  })
})
