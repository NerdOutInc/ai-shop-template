import { describe, expect, it } from "vitest"

import { prepareConceptPreview } from "./prepare-concept-preview"

function fixture() {
  const width = 12
  const height = 12
  const data = new Uint8ClampedArray(width * height * 4)
  for (let pixel = 0; pixel < width * height; pixel++) data.set([20, 30, 40, 255], pixel * 4)
  // A closed cream outline encloses deliberately dark ink matching the matte.
  for (let y = 4; y < 8; y++) {
    for (let x = 4; x < 8; x++) {
      if (x === 4 || x === 7 || y === 4 || y === 7) data.set([240, 230, 210, 255], (y * width + x) * 4)
    }
  }
  return { data, width, height }
}

describe("prepareConceptPreview", () => {
  it("samples the original matte and clears its exterior without erasing enclosed ink", () => {
    const pixels = fixture()
    expect(prepareConceptPreview(pixels)).toBe("#141e28")
    expect([...pixels.data.slice(0, 4)]).toEqual([0, 0, 0, 0])
    expect([...pixels.data.slice((4 * 12 + 4) * 4, (4 * 12 + 4) * 4 + 4)]).toEqual([240, 230, 210, 255])
    expect([...pixels.data.slice((5 * 12 + 5) * 4, (5 * 12 + 5) * 4 + 4)]).toEqual([20, 30, 40, 255])
  })

  it("preserves already-transparent pixels and partial-alpha edges exactly", () => {
    const pixels = fixture()
    pixels.data[3] = 0
    pixels.data[(4 * 12 + 4) * 4 + 3] = 128
    const before = pixels.data.slice()
    expect(prepareConceptPreview(pixels)).toBeNull()
    expect(pixels.data).toEqual(before)
  })

  it("leaves multicolor borders and blank images unchanged", () => {
    const pixels = fixture()
    pixels.data.set([230, 240, 250, 255], 0)
    const before = pixels.data.slice()
    expect(prepareConceptPreview(pixels)).toBeNull()
    expect(pixels.data).toEqual(before)
    const blank = { data: new Uint8ClampedArray(12 * 12 * 4).fill(255), width: 12, height: 12 }
    expect(prepareConceptPreview(blank)).toBeNull()
    expect(blank.data.every((value) => value === 255)).toBe(true)
  })

  it("unmattes feathered edges while keeping their composited source color", () => {
    const pixels = fixture()
    const offset = (3 * 12 + 5) * 4
    pixels.data.set([42, 52, 62, 255], offset)
    expect(prepareConceptPreview(pixels)).toBe("#141e28")
    const alpha = pixels.data[offset + 3]! / 255
    expect(alpha).toBeCloseTo(0.5, 2)
    for (const [channel, bg] of [20, 30, 40].entries()) {
      expect(pixels.data[offset + channel]! * alpha + bg * (1 - alpha)).toBeCloseTo(42 + channel * 10, 0)
    }
  })
})
