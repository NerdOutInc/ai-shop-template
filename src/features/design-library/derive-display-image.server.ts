import "server-only"

import { createHash } from "node:crypto"

import sharp from "sharp"

import type { LibraryStoredAsset } from "./library-types"

import { DISPLAY_IMAGE_SIZES, type DisplayImageSize } from "./display-image-sizes"
import { LibraryError } from "./library-error"

/**
 * Resizes prepared artwork for browsing. It never removes a background: transparency is
 * decided during preparation and uploaded, so a source without it is a preparation
 * problem to surface rather than something to guess at here.
 *
 * Lossless WebP costs about the same bytes as quality 80 on flat-colour illustration and
 * less than quality 90 at the large size, so there is nothing to gain by discarding pixels.
 */
export async function deriveDisplayImage(
  bytes: Buffer,
  asset: LibraryStoredAsset,
  size: DisplayImageSize,
  options: { seconds?: number } = {}
) {
  if (
    asset.status !== "ready" ||
    asset.hasAlpha !== true ||
    asset.hasTransparency !== true ||
    bytes.length !== asset.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== asset.sha256
  )
    throw new LibraryError("INVALID_INPUT", "Display artwork needs verified transparent source bytes")
  const edge = DISPLAY_IMAGE_SIZES[size]
  const deadline = Date.now() + (options.seconds ?? 20) * 1000
  const remaining = () => {
    const seconds = Math.floor((deadline - Date.now()) / 1000)
    if (seconds < 1) throw new Error("Display artwork took too long to prepare")
    return seconds
  }
  try {
    const source = sharp(bytes, { limitInputPixels: 40_000_000, failOn: "warning" })
    const metadata = await source.timeout({ seconds: remaining() }).metadata()
    if (
      !metadata.hasAlpha ||
      (metadata.pages ?? 1) !== 1 ||
      metadata.width !== asset.width ||
      metadata.height !== asset.height ||
      metadata.width < 2 ||
      metadata.height < 2
    )
      throw new LibraryError("INVALID_INPUT", "Display artwork source is not the registered image")
    const result = await source
      .timeout({ seconds: remaining() })
      // The full canvas is the print canvas: cropping here would move the artwork
      // relative to the placement recorded for the product.
      .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
      .webp({ lossless: true, effort: 4 })
      .toBuffer({ resolveWithObject: true })
    return {
      bytes: result.data,
      width: result.info.width,
      height: result.info.height,
      sha256: createHash("sha256").update(result.data).digest("hex"),
    }
  } catch (cause) {
    if (cause instanceof LibraryError) throw cause
    throw new Error("Display artwork could not be prepared")
  }
}
