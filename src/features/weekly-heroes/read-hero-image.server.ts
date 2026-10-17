import "server-only"
import { createHash } from "node:crypto"
import { get } from "@vercel/blob"
import { readBoundedArtworkStream } from "@/features/design-library/read-bounded-artwork-stream.server"
import { env } from "@/lib/env"
import type { StoredHeroAsset } from "./weekly-hero-store.server"

/** Call only after a current-week or active-admin gate. Never returns a private Blob URL. */
export async function readHeroImage(asset: StoredHeroAsset) {
  if (!env.PRIVATE_BLOB_READ_WRITE_TOKEN) return null
  const result = await get(asset.pathname, {
    access: "private",
    token: env.PRIVATE_BLOB_READ_WRITE_TOKEN,
    useCache: false,
  })
  if (!result || result.statusCode !== 200) throw new Error("Hero image unavailable")
  const bytes = await readBoundedArtworkStream(result.stream, asset.bytes)
  if (bytes.length !== asset.bytes || createHash("sha256").update(bytes).digest("hex") !== asset.sha256)
    throw new Error("Hero image changed")
  return { bytes, contentType: asset.contentType }
}
