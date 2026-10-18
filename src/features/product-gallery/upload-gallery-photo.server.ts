import "server-only"
import { createHash, randomUUID } from "node:crypto"
import { put } from "@vercel/blob"
import sharp, { type OutputInfo } from "sharp"
import { readBoundedArtworkStream } from "@/features/design-library/read-bounded-artwork-stream.server"
import { env } from "@/lib/env"
import { storeConfig } from "@/lib/store-config"
import { getProductGalleryStore } from "./get-product-gallery-store.server"
import { GalleryError } from "./gallery-error"

export async function uploadGalleryPhoto(request: Request, product: string, actor: string) {
  const store = getProductGalleryStore()
  await store.read(product)
  if (!env.PRIVATE_BLOB_READ_WRITE_TOKEN)
    throw new GalleryError("Configure private photo storage before uploading.", 409, "PHOTO_STORAGE_CONFIGURATION")
  if ((await store.assetCount(product)) >= 500)
    throw new GalleryError("This product has reached its 500-photo archive limit.")
  const length = Number(request.headers.get("x-photo-bytes"))
  if (!request.body || !Number.isSafeInteger(length) || length < 1 || length > 3145728)
    throw new GalleryError("Choose one JPEG, PNG or WebP smaller than 3 MB.", 400)
  let derivative: { data: Buffer; info: OutputInfo }
  try {
    const input = await readBoundedArtworkStream(request.body, length)
    const metadata = await sharp(input, { limitInputPixels: 40_000_000, failOn: "truncated" }).metadata()
    if (
      !["jpeg", "png", "webp"].includes(metadata.format ?? "") ||
      (metadata.pages ?? 1) !== 1 ||
      Math.min(metadata.width ?? 0, metadata.height ?? 0) < 800
    )
      throw new Error("format")
    // Re-encoding drops EXIF, location and orientation metadata; transparency lands on the storefront background.
    derivative = await sharp(input, { limitInputPixels: 40_000_000, failOn: "truncated" })
      .timeout({ seconds: 5 })
      .rotate()
      .toColourspace("srgb")
      .flatten({ background: storeConfig.theme.background })
      .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer({ resolveWithObject: true })
    if (derivative.data.length > 3145728) throw new Error("size")
  } catch {
    throw new GalleryError(
      "Use a valid, non-animated JPEG, PNG or WebP at least 800 pixels on both sides and under 3 MB.",
      400
    )
  }
  const id = randomUUID(),
    pathname = `product-gallery/v1/${id}.jpg`
  await put(pathname, derivative.data, {
    access: "private",
    token: env.PRIVATE_BLOB_READ_WRITE_TOKEN,
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType: "image/jpeg",
    abortSignal: AbortSignal.timeout(10000),
  })
  const asset = {
    id,
    pathname,
    sha256: createHash("sha256").update(derivative.data).digest("hex"),
    bytes: derivative.data.length,
    width: derivative.info.width,
    height: derivative.info.height,
    contentType: "image/jpeg" as const,
  }
  await store.addAsset(product, asset, actor)
  return { id, width: asset.width, height: asset.height }
}
