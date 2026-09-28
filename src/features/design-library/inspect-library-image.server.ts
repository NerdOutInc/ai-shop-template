import "server-only"

import { createHash } from "node:crypto"

import sharp from "sharp"

/** Inspect preserved bytes without changing geometry; this contract also verifies private uploads. */
export async function inspectLibraryImage(bytes: Buffer) {
  if (bytes.length > 64 * 1024 * 1024) throw new Error("Asset exceeds the 64 MiB inspection limit")
  const decoder = sharp(bytes, { limitInputPixels: 40_000_000, failOn: "warning" })
  const metadata = await decoder.metadata()
  if (!["png", "jpeg", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) !== 1)
    throw new Error("Expected a single PNG, JPEG, or WebP image")
  const { data, info } = await decoder.toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const pixelSha256 = createHash("sha256").update(`${info.width}x${info.height}:rgba8\0`).update(data).digest("hex")
  let hasTransparency = false
  let hasVisiblePixels = false
  for (let index = 3; index < data.length; index += 4) {
    if (data[index]! < 255) hasTransparency = true
    if (data[index]! > 0) hasVisiblePixels = true
    if (hasTransparency && hasVisiblePixels) break
  }
  if (!hasVisiblePixels) throw new Error("Artwork contains no visible pixels")
  const thumbnail = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: "warning" })
    .flatten({ background: { r: 128, g: 128, b: 128 } })
    .resize(9, 8, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer()
  let difference = 0n
  for (let row = 0; row < 8; row++)
    for (let column = 0; column < 8; column++)
      difference = (difference << 1n) | (thumbnail[row * 9 + column]! > thumbnail[row * 9 + column + 1]! ? 1n : 0n)
  const perceptualHash = difference.toString(16).padStart(16, "0")
  return {
    mimeType: `image/${metadata.format}`,
    width: info.width,
    height: info.height,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    pixelSha256,
    perceptualHash,
    hasAlpha: metadata.hasAlpha,
    hasTransparency,
  }
}
