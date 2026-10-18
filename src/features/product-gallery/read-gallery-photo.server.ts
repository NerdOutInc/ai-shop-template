import "server-only"
import { createHash } from "node:crypto"
import { BlobNotFoundError, get } from "@vercel/blob"
import { classifyImageStorageError } from "@/features/publishing/classify-image-storage-error"
import { readBoundedArtworkStream } from "@/features/design-library/read-bounded-artwork-stream.server"
import { env } from "@/lib/env"
import type { GalleryAsset } from "./product-gallery-store.server"
import { GalleryError } from "./gallery-error"
/** The caller must establish current admin access and product ownership first. */
export async function readGalleryPhoto(asset: GalleryAsset) {
  if (!env.PRIVATE_BLOB_READ_WRITE_TOKEN)
    throw new GalleryError("Configure private photo storage before activation.", 409, "PHOTO_STORAGE_CONFIGURATION")
  const result = await get(asset.pathname, {
    access: "private",
    token: env.PRIVATE_BLOB_READ_WRITE_TOKEN,
    useCache: false,
    abortSignal: AbortSignal.timeout(5000),
  }).catch((error: unknown) => {
    if (error instanceof BlobNotFoundError)
      throw new GalleryError(
        "The private original is missing. Upload a replacement and review it.",
        409,
        "PHOTO_MISSING"
      )
    const classified = classifyImageStorageError(error)
    if (!classified.retryable)
      throw new GalleryError(
        "Private photo storage is not accessible. Check its token and store configuration.",
        409,
        "PHOTO_STORAGE_CONFIGURATION"
      )
    throw error
  })
  if (!result)
    throw new GalleryError("The private original is missing. Upload a replacement and review it.", 409, "PHOTO_MISSING")
  if (result.statusCode !== 200) throw new Error("Private photo response unconfirmed")
  if (result.blob.size !== asset.bytes) {
    await result.stream.cancel().catch(() => undefined)
    throw new GalleryError("The private original changed. Upload a replacement and review it.", 409, "PHOTO_CHANGED")
  }
  const bytes = await readBoundedArtworkStream(result.stream, asset.bytes)
  if (createHash("sha256").update(bytes).digest("hex") !== asset.sha256)
    throw new GalleryError("The private original changed. Upload a replacement and review it.", 409, "PHOTO_CHANGED")
  return bytes
}
