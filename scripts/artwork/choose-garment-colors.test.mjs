import assert from "node:assert/strict"
import test from "node:test"

import { GARMENT_COLORS } from "../../src/features/design-library/garment-colors.ts"

import { chooseGarmentColors, hexToRgb, readability, sampleInk, toLab } from "./choose-garment-colors.mjs"

const lab = (hex) => toLab(hexToRgb(hex))
const ink = (hexes) => hexes.map(lab)
const names = (colors) => colors.map((color) => color.name)

test("lightness separation decides what a garment would swallow", () => {
  const cream = ink(["#efe6d1"])
  assert.equal(readability(cream, lab("#f6fbfe")).lost, 1, "cream lettering disappears on white")
  assert.equal(readability(cream, lab("#242529")).visible, 1, "the same lettering reads on black")
})

test("keeps the garment the artist drew for", () => {
  const chosen = chooseGarmentColors(GARMENT_COLORS, ink(["#efe6d1", "#d84a3a"]), "#141414")
  assert.equal(chosen.length, 5)
  assert.equal(chosen[0].name, "CVC Black", "the nearest palette color to the recorded background leads")
})

test("refuses a garment that erases the artwork even when it suits most of it", () => {
  // Mostly dark ink with cream lettering: white clears the dark mass but kills the title.
  const artwork = ink([...Array(9).fill("#1d2430"), "#efe6d1"])
  assert.ok(!names(chooseGarmentColors(GARMENT_COLORS, artwork, "#f2e4cb")).includes("CVC White"))
})

test("prefers variety but gives it up rather than lose ink", () => {
  const lightInk = ink(["#f4efe2", "#ffffff", "#e8e2d0"])
  const chosen = names(chooseGarmentColors(GARMENT_COLORS, lightInk, "#141414"))
  assert.equal(chosen.length, 5)
  // Light ink only survives on a garment well below it, so no pale garment gets offered.
  for (const name of chosen) {
    const garment = GARMENT_COLORS.find((color) => color.name === name)
    assert.ok(lab(garment.hex)[0] < 65, `${name} is too light for light ink`)
  }
  assert.equal(new Set(chosen).size, 5, "a color is never offered twice")
})

test("colors the store already sells for a design are kept, not re-derived", () => {
  const seed = ["CVC Sand", "CVC Cream", "CVC Mint", "CVC Ice Blue", "CVC White"]
  assert.deepEqual(names(chooseGarmentColors(GARMENT_COLORS, ink(["#141414"]), "#141414", { seed })), seed)
})

test("a partial Printify record keeps its color and has the rest scored", () => {
  const chosen = names(chooseGarmentColors(GARMENT_COLORS, ink(["#efe6d1"]), "#141414", { seed: ["CVC Espresso"] }))
  assert.equal(chosen[0], "CVC Espresso")
  assert.equal(chosen.length, 5)
})

test("ink excludes the recorded background and transparent pixels", () => {
  const width = 2,
    height = 2
  // Two background pixels, one transparent, one red.
  const data = Uint8ClampedArray.from([20, 20, 20, 255, 20, 20, 20, 255, 0, 0, 0, 0, 216, 74, 58, 255])
  const sampled = sampleInk({ data, width, height }, [20, 20, 20], 1)
  assert.equal(sampled.length, 1)
  assert.ok(Math.abs(sampled[0][0] - lab("#d84a3a")[0]) < 1)
})

test("artwork drawn entirely in its own background color still gets judged", () => {
  const data = Uint8ClampedArray.from([20, 20, 20, 255, 20, 20, 20, 255, 20, 20, 20, 255, 20, 20, 20, 255])
  assert.equal(sampleInk({ data, width: 2, height: 2 }, [20, 20, 20], 1).length, 4)
})
