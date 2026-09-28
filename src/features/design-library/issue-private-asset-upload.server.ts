import "server-only"

import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client"

import { env } from "@/lib/env"

import type { LibraryStoredAsset } from "./library-types"

import { privateAssetPathname } from "./private-asset-pathname"

export async function issuePrivateAssetUpload(asset: LibraryStoredAsset) {
  if (!env.PRIVATE_BLOB_READ_WRITE_TOKEN) throw new Error("Private artwork storage is not configured")
  if (asset.status !== "pending" || !asset.bytes || asset.bytes > 64 * 1024 * 1024)
    throw new Error("Only registered pending artwork within the upload limit can be uploaded")
  const pathname = privateAssetPathname(asset)
  const expiresAt = Date.now() + 5 * 60_000
  const token = await generateClientTokenFromReadWriteToken({
    token: env.PRIVATE_BLOB_READ_WRITE_TOKEN,
    pathname,
    validUntil: expiresAt,
    maximumSizeInBytes: asset.bytes,
    allowedContentTypes: [asset.mimeType],
    addRandomSuffix: false,
    allowOverwrite: false,
  })
  return { token, pathname, access: "private" as const, expiresAt, contentType: asset.mimeType }
}
