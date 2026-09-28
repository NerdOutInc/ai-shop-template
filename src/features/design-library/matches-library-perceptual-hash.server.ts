import "server-only"

import sharp from "sharp"

/** Compare a similarity fingerprint after exact file and pixel integrity have passed. */
export async function matchesLibraryPerceptualHash(bytes: Buffer, expected: string | null) {
  if (!expected || !/^[a-f0-9]{16}$/.test(expected)) return false
  const thumbnail = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: "warning" })
    .flatten({ background: { r: 128, g: 128, b: 128 } })
    .resize(9, 8, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer()
  let fingerprint = 0n
  let roundingMask = 0n
  for (let row = 0; row < 8; row++) {
    for (let column = 0; column < 8; column++) {
      const difference = thumbnail[row * 9 + column]! - thumbnail[row * 9 + column + 1]!
      fingerprint = (fingerprint << 1n) | (difference > 0 ? 1n : 0n)
      // ARM and x64 resampling can round a sampled brightness one level apart.
      // Only comparisons at that boundary may differ; every other bit stays exact.
      roundingMask = (roundingMask << 1n) | (Math.abs(difference) <= 1 ? 1n : 0n)
    }
  }
  let changed = fingerprint ^ BigInt(`0x${expected}`)
  if ((changed & ~roundingMask) !== 0n) return false
  let changedBits = 0
  while (changed) {
    changed &= changed - 1n
    if (++changedBits > 2) return false
  }
  return true
}
