// @vitest-environment node
import sharp from "sharp"
import { expect, it, vi } from "vitest"

import { inspectLibraryImage } from "./inspect-library-image.server"
import { matchesLibraryPerceptualHash } from "./matches-library-perceptual-hash.server"

vi.mock("server-only", () => ({}))

it("accepts only rounding-boundary differences, not arbitrary nearby fingerprints", async () => {
  const row = [140, 139, 100, 100, 120, 160, 130, 130, 70]
  const bytes = await sharp(Buffer.from(Array.from({ length: 8 }, () => row).flat()), {
    raw: { width: 9, height: 8, channels: 1 },
  })
    .png()
    .toBuffer()
  const { perceptualHash } = await inspectLibraryImage(bytes)
  const flipped = (bit: bigint) => (BigInt(`0x${perceptualHash}`) ^ bit).toString(16).padStart(16, "0")
  await expect(matchesLibraryPerceptualHash(bytes, perceptualHash)).resolves.toBe(true)
  await expect(matchesLibraryPerceptualHash(bytes, flipped(1n << 63n))).resolves.toBe(true)
  await expect(matchesLibraryPerceptualHash(bytes, flipped(1n << 62n))).resolves.toBe(false)
  await expect(matchesLibraryPerceptualHash(bytes, flipped((1n << 63n) | (1n << 55n) | (1n << 47n)))).resolves.toBe(
    false
  )
  await expect(matchesLibraryPerceptualHash(bytes, null)).resolves.toBe(false)
  await expect(matchesLibraryPerceptualHash(bytes, "invalid")).resolves.toBe(false)
})
