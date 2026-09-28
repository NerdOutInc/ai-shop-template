import "server-only"

import { get, put } from "@vercel/blob"

import { env } from "@/lib/env"

import type { LibraryStoredAsset } from "./library-types"
import type { DisplayImageSize } from "./display-image-sizes"

import { deriveDisplayImage } from "./derive-display-image.server"
import { displayImagePathname } from "./display-image-pathname"
import { readBoundedArtworkStream } from "./read-bounded-artwork-stream.server"
import { readPrivateAsset } from "./read-private-asset.server"

type DisplayImage = { body: Buffer | ReadableStream<Uint8Array>; bytes: number; sha256: string | null }

/** The narrow slice of Blob storage this needs, so a test can stand in without casting. */
type DisplayBlobStorage = {
  get: (
    pathname: string,
    options: { access: "private"; token: string; abortSignal?: AbortSignal }
  ) => Promise<{
    statusCode: number
    blob: { size: number | null; contentType: string | null }
    stream: ReadableStream<Uint8Array> | null
  } | null>
  put: (
    pathname: string,
    bytes: Buffer,
    options: {
      access: "private"
      token: string
      addRandomSuffix: false
      allowOverwrite: false
      contentType: string
      cacheControlMaxAge: number
      abortSignal?: AbortSignal
    }
  ) => Promise<unknown>
}

/**
 * The Blob SDK retries a failed request ten times with exponential backoff, which would
 * hold a gallery image open for minutes during a storage blip. These budgets turn that
 * into a fast, visible failure instead.
 */
const READ_TIMEOUT_MS = 10_000
const WRITE_TIMEOUT_MS = 15_000

export type ReadDisplayImageOptions = {
  signal?: AbortSignal
  readAsset?: (
    asset: LibraryStoredAsset,
    options?: { signal?: AbortSignal }
  ) => Promise<ReadableStream<Uint8Array> | null>
  storage?: DisplayBlobStorage
}

/**
 * Serves a browsing-sized copy of prepared artwork, deriving it once and keeping it beside
 * the master in the same private store. Output is deterministic from the source hash and
 * the size, so two requests racing on a cold path produce identical bytes and whichever
 * write loses simply reads what the winner stored.
 *
 * Returns null when the asset is not prepared transparent artwork. The server does not
 * remove backgrounds, so an opaque master has no browsing size to offer.
 */
export async function readDisplayImage(
  asset: LibraryStoredAsset,
  size: DisplayImageSize,
  options: ReadDisplayImageOptions = {}
): Promise<DisplayImage | null> {
  const token = env.PRIVATE_BLOB_READ_WRITE_TOKEN
  if (!token) throw new Error("Private artwork storage is not configured")
  if (asset.status !== "ready" || asset.hasAlpha !== true || asset.hasTransparency !== true) return null
  const pathname = displayImagePathname(asset, size)
  const storage = options.storage ?? { get, put }
  const { signal } = options
  // Caller-supplied cancellation still wins; these only cap how long storage may stall.
  const bounded = (milliseconds: number) =>
    signal ? AbortSignal.any([signal, AbortSignal.timeout(milliseconds)]) : AbortSignal.timeout(milliseconds)

  // An arrow const, not a hoisted declaration: hoisting would discard the token narrowing.
  const cached = async () => {
    const result = await storage
      .get(pathname, { access: "private", token, abortSignal: bounded(READ_TIMEOUT_MS) })
      .catch(() => null)
    if (!result || result.statusCode !== 200 || !result.stream) return null
    if (result.blob.contentType !== "image/webp" || !result.blob.size) {
      await result.stream.cancel().catch(() => undefined)
      return null
    }
    return { body: result.stream, bytes: result.blob.size, sha256: null }
  }

  const hit = await cached()
  if (hit) return hit

  const stream = await (options.readAsset ?? readPrivateAsset)(asset, signal ? { signal } : {})
  if (!stream || !asset.bytes) return null
  const derivative = await deriveDisplayImage(await readBoundedArtworkStream(stream, asset.bytes), asset, size)
  try {
    await storage.put(pathname, derivative.bytes, {
      access: "private",
      token,
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: "image/webp",
      cacheControlMaxAge: 31_536_000,
      abortSignal: bounded(WRITE_TIMEOUT_MS),
    })
  } catch {
    // Either a request that raced ahead already stored identical bytes, or storage is
    // unwell. Prefer the stored copy, and otherwise still serve what was just derived:
    // losing the cache costs time on the next request, not this one.
    const raced = await cached()
    if (raced) return raced
  }
  return { body: derivative.bytes, bytes: derivative.bytes.length, sha256: derivative.sha256 }
}
