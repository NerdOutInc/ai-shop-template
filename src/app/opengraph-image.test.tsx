// @vitest-environment node
import sharp from "sharp"
import { beforeEach, expect, it, vi } from "vitest"

import OpenGraphImage, { alt, size } from "./opengraph-image"

const config = vi.hoisted(() => ({
  name: "The Extraordinarily Long Coastal Forest Coffee and Tee Company of Maine",
  tagline: "Made for wherever the day takes you. ".repeat(30),
  description: "Original apparel with a story to tell. ".repeat(30),
  theme: { primary: "#000000", primaryForeground: "#ffffff" },
}))
vi.mock("@/lib/store-config", () => ({ storeConfig: config }))
// Next's route cache wrapper requires its server runtime; use its real bundled PNG renderer.
vi.mock("next/og", () => import("next/dist/compiled/@vercel/og/index.node.js"))

const originalConfig = { ...config }
beforeEach(() => Object.assign(config, originalConfig))

it("retains complete alternative text when the visual copy is shortened", () => {
  expect(alt).toBe(`${config.name}. ${config.tagline}`)
})

it.each([
  "Your Store",
  "The Extraordinarily Long Coastal Forest Coffee and Tee Company of Maine",
  "W".repeat(20),
  "W".repeat(21),
  "W".repeat(40),
  "W".repeat(41),
  "W".repeat(70),
])("renders %s with visible text, clear separation, and safe card edges", async (name) => {
  config.name = name
  if (name === "W".repeat(70)) {
    config.tagline = "W".repeat(1000)
    config.description = "W".repeat(1000)
  }
  const response = OpenGraphImage()
  expect(response.headers.get("content-type")).toBe("image/png")
  const bytes = Buffer.from(await response.arrayBuffer())
  const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  expect(info).toMatchObject(size)

  const litPixels = (left: number, top: number, width: number, height: number) => {
    let count = 0
    for (let y = top; y < top + height; y++) {
      for (let x = left; x < left + width; x++) {
        if (data[(y * info.width + x) * info.channels]! > 32) count++
      }
    }
    return count
  }

  // Check the actual PNG rather than assuming Satori applies browser CSS identically.
  expect(litPixels(0, 0, 1200, 65)).toBe(0)
  expect(litPixels(0, 565, 1200, 65)).toBe(0)
  expect(litPixels(0, 0, 75, 630)).toBe(0)
  expect(litPixels(1125, 0, 75, 630)).toBe(0)
  expect(litPixels(0, 145, 1200, 20)).toBe(0)
  expect(litPixels(0, 418, 1200, 20)).toBe(0)
  expect(litPixels(80, 70, 1040, 70)).toBeGreaterThan(100)
  expect(litPixels(80, 172, 1040, 240)).toBeGreaterThan(100)
  expect(litPixels(80, 443, 1040, 117)).toBeGreaterThan(100)
})
