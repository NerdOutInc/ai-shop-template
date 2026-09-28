import "server-only"

import { get } from "@vercel/blob"

import { env } from "@/lib/env"

import type { LibraryStoredAsset } from "./library-types"

import { inspectLibraryImage } from "./inspect-library-image.server"
import { matchesLibraryPerceptualHash } from "./matches-library-perceptual-hash.server"
import { privateAssetPathname } from "./private-asset-pathname"
import { readBoundedArtworkStream } from "./read-bounded-artwork-stream.server"

export async function verifyPrivateAssetUpload(asset: LibraryStoredAsset) {
  if (!env.PRIVATE_BLOB_READ_WRITE_TOKEN) throw new Error("Private artwork storage is not configured")
  if (!asset.bytes || !["pending", "ready"].includes(asset.status)) throw new Error("Artwork is not uploadable")
  const pathname = privateAssetPathname(asset)
  const result = await get(pathname, { access: "private", token: env.PRIVATE_BLOB_READ_WRITE_TOKEN, useCache: false })
  if (!result || result.statusCode !== 200) throw new Error("Artwork upload has not completed")
  if (result.blob.size !== asset.bytes || result.blob.contentType !== asset.mimeType) {
    await result.stream.cancel()
    throw new Error("Uploaded file does not match the registered artwork")
  }
  const bytes = await readBoundedArtworkStream(result.stream, asset.bytes)
  const inspected = await inspectLibraryImage(bytes)
  const keys = ["sha256", "pixelSha256", "bytes", "width", "height", "mimeType", "hasAlpha", "hasTransparency"] as const
  if (keys.some((key) => inspected[key] !== asset[key]))
    throw new Error("Uploaded bytes do not match the selected artwork revision")
  if (
    inspected.perceptualHash !== asset.perceptualHash &&
    !(await matchesLibraryPerceptualHash(bytes, asset.perceptualHash))
  )
    throw new Error("Uploaded similarity fingerprint does not match the selected artwork revision")
  if (asset.kind === "print" && (inspected.mimeType !== "image/png" || !inspected.hasTransparency))
    throw new Error("Print artwork must be a transparent PNG")
  return {
    assetId: asset.id,
    pathname,
    sha256: inspected.sha256,
    pixelSha256: inspected.pixelSha256,
    bytes: inspected.bytes,
  }
}
