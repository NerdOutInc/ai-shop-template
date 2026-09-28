import assert from "node:assert/strict"
import test from "node:test"

import { cutOutMatte } from "./cut-out-matte.mjs"

/** A canvas of `matte` with `paint(set)` drawing opaque ink. */
function canvas(width, height, matte, paint = () => {}) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let pixel = 0; pixel < width * height; pixel++) {
    data.set(matte, pixel * 4)
    data[pixel * 4 + 3] = 255
  }
  paint((x, y, color) => data.set([...color, 255], (y * width + x) * 4))
  return { data, width, height }
}

const alphaAt = ({ data, width }, x, y) => data[(y * width + x) * 4 + 3]

test("clears the matte connected to the edge and keeps the ink", () => {
  const image = canvas(40, 40, [20, 20, 20], (set) => {
    for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) set(x, y, [240, 230, 200])
  })
  const result = cutOutMatte(image)
  assert.equal(result.matteHex, "#141414")
  assert.equal(alphaAt(image, 1, 1), 0)
  assert.equal(alphaAt(image, 20, 20), 255)
})

test("keeps matte-coloured ink that the artwork encloses", () => {
  const image = canvas(40, 40, [20, 20, 20], (set) => {
    for (let y = 10; y < 30; y++)
      for (let x = 10; x < 30; x++)
        // A ring of ink around a hole the same colour as the matte.
        if (x < 15 || x >= 25 || y < 15 || y >= 25) set(x, y, [240, 230, 200])
  })
  cutOutMatte(image)
  assert.equal(alphaAt(image, 20, 20), 255, "the enclosed hole is not reachable from the edge")
})

test("leaves artwork that already carries alpha untouched", () => {
  const image = canvas(20, 20, [20, 20, 20])
  image.data[3] = 0
  assert.equal(cutOutMatte(image), null)
  assert.equal(alphaAt(image, 1, 0), 255)
})

test("refuses a border that is not a flat matte", () => {
  const image = canvas(40, 40, [20, 20, 20], (set) => {
    for (let x = 0; x < 40; x++) set(x, 0, [250, 10, 10])
  })
  assert.equal(cutOutMatte(image), null)
})

test("refuses a blank canvas with no artwork on it", () => {
  assert.equal(cutOutMatte(canvas(40, 40, [20, 20, 20])), null)
})

test("unmixes an antialiased edge instead of leaving a halo of the old background", () => {
  const matte = [20, 20, 20]
  // A rim pixel that is mostly matte with a little ink mixed in.
  const blended = [45, 44, 42]
  const image = canvas(40, 40, matte, (set) => {
    for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) set(x, y, [240, 230, 200])
    for (let y = 10; y < 30; y++) set(9, y, blended)
  })
  cutOutMatte(image)
  const edge = (9 + 20 * 40) * 4
  const alpha = image.data[edge + 3] / 255
  assert.ok(alpha > 0 && alpha < 1, `the blended pixel keeps partial alpha, got ${alpha}`)
  // Compositing the unmixed colour back over the matte must reproduce what was there, so
  // the same pixel over a different garment carries no trace of the old background.
  for (const channel of [0, 1, 2])
    assert.ok(
      Math.abs(image.data[edge + channel] * alpha + matte[channel] * (1 - alpha) - blended[channel]) <= 2,
      `channel ${channel} did not round-trip over its own matte`
    )
})

test("clamps an unmixed fringe brighter than its matte instead of wrapping to black", () => {
  // Light matte, near-white ink: unmixing the fringe overshoots 255. A raw Buffer would
  // wrap it to near-black, which is the halo this is meant to prevent.
  const matte = [200, 200, 200]
  const image = canvas(40, 40, matte, (set) => {
    for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) set(x, y, [250, 250, 250])
    for (let y = 10; y < 30; y++) set(9, y, [218, 218, 218])
  })
  // Production reads pixels through sharp, which hands back a Node Buffer.
  image.data = Buffer.from(image.data)
  cutOutMatte(image)
  const edge = (9 + 20 * 40) * 4
  assert.ok(image.data[edge] > 200, `expected a light unmixed fringe, got ${image.data[edge]}`)
})
