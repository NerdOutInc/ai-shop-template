import "server-only"

import { createHash } from "node:crypto"

import sharp from "sharp"

import type { LibraryStoredAsset } from "@/features/design-library/library-types"

import { PublishedImageError } from "./published-image-error"

export async function derivePublishedArtwork(bytes: Buffer, asset: LibraryStoredAsset, seconds = 5) {
  if (
    asset.kind !== "print" ||
    asset.status !== "ready" ||
    asset.mimeType !== "image/png" ||
    !asset.hasAlpha ||
    !asset.hasTransparency ||
    bytes.length !== asset.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== asset.sha256
  ) {
    throw new PublishedImageError("IMAGE_SOURCE_CHANGED", false)
  }
  const deadline = Date.now() + seconds * 1000
  const remainingSeconds = () => {
    const remaining = Math.floor((deadline - Date.now()) / 1000)
    if (remaining < 1) throw new PublishedImageError("IMAGE_DERIVATION_TIMEOUT", false)
    return remaining
  }
  try {
    const source = sharp(bytes, { limitInputPixels: 40_000_000, failOn: "warning" }).timeout({
      seconds: remainingSeconds(),
    })
    const metadata = await source.metadata()
    if (
      metadata.format !== "png" ||
      !metadata.hasAlpha ||
      (metadata.pages ?? 1) !== 1 ||
      metadata.width !== asset.width ||
      metadata.height !== asset.height ||
      metadata.width < 2 ||
      metadata.height < 2
    )
      throw new PublishedImageError("IMAGE_CONTENT_INVALID", false)
    // Preserve the full canvas, but reduce even small masters so public pixels never equal print resolution.
    const result = await source
      .timeout({ seconds: remainingSeconds() })
      .resize({
        width: Math.min(1200, Math.floor(metadata.width * 0.75)),
        height: Math.min(1200, Math.floor(metadata.height * 0.75)),
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ lossless: true, effort: 4 })
      .toBuffer({ resolveWithObject: true })
    const stats = await sharp(result.data).timeout({ seconds: remainingSeconds() }).stats()
    const alpha = stats.channels[3]
    if (!alpha || alpha.min === 255 || alpha.max === 0) throw new PublishedImageError("IMAGE_CONTENT_INVALID", false)
    return {
      bytes: result.data,
      width: result.info.width,
      height: result.info.height,
      sha256: createHash("sha256").update(result.data).digest("hex"),
    }
  } catch (error) {
    if (error instanceof PublishedImageError) throw error
    if (error instanceof Error && /timeout/i.test(error.message))
      throw new PublishedImageError("IMAGE_DERIVATION_TIMEOUT", false)
    throw new PublishedImageError("IMAGE_CONTENT_INVALID", false)
  }
}
