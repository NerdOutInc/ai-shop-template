import "server-only"

import { get } from "@vercel/blob"

import { env } from "@/lib/env"

import type { LibraryStoredAsset } from "./library-types"

import { privateAssetPathname } from "./private-asset-pathname"

export async function readPrivateAsset(asset: LibraryStoredAsset, options: { signal?: AbortSignal } = {}) {
  if (!env.PRIVATE_BLOB_READ_WRITE_TOKEN) throw new Error("Private artwork storage is not configured")
  if (asset.status !== "ready" || asset.pathname !== privateAssetPathname(asset))
    throw new Error("Private artwork is not ready")
  const result = await get(asset.pathname, {
    access: "private",
    token: env.PRIVATE_BLOB_READ_WRITE_TOKEN,
    ...(options.signal ? { abortSignal: options.signal } : {}),
  })
  if (!result || result.statusCode !== 200) return null
  if (result.blob.size !== asset.bytes || result.blob.contentType !== asset.mimeType) {
    await result.stream.cancel()
    throw new Error("Private artwork metadata no longer matches its verified revision")
  }
  return result.stream
}
