// @vitest-environment node
import sharp from "sharp"
import { expect, it, vi } from "vitest"

import { inspectLibraryImage } from "./inspect-library-image.server"

vi.mock("server-only", () => ({}))

it("rejects fully transparent blank artwork but accepts a visible pixel", async () => {
  const empty = await sharp({
    create: { width: 2, height: 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toBuffer()
  await expect(inspectLibraryImage(empty)).rejects.toThrow("no visible pixels")
  const visible = await sharp(Buffer.from([255, 0, 0, 255, 0, 0, 0, 0]), { raw: { width: 2, height: 1, channels: 4 } })
    .png()
    .toBuffer()
  const result = await inspectLibraryImage(visible)
  expect(result.hasTransparency).toBe(true)
  expect(result.perceptualHash).toMatch(/^[a-f0-9]{16}$/)
})
