import { expect, it } from "vitest"

import { getConceptPreviewColors } from "./get-concept-preview-colors"

it.each(["#fff8ec", "#FFF8EC", "#142333", "#9b6871", "#e4e9e6"])(
  "keeps %s first with exactly four distinct alternatives",
  (hex) => {
    const colors = getConceptPreviewColors({ name: "Recorded color", hex })
    expect(colors).toHaveLength(5)
    expect(colors[0]).toEqual({ name: "Original background", hex })
    expect(new Set(colors.map((color) => color.hex.toLowerCase())).size).toBe(5)
  }
)
