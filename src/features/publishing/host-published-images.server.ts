import "server-only"

import { createHash } from "node:crypto"
import {
  BlobAccessError,
  BlobNotFoundError,
  BlobStoreNotFoundError,
  BlobStoreSuspendedError,
  head,
  put,
} from "@vercel/blob"

import { isPublicBlobHost } from "@/lib/is-public-blob-host"

import { PublishedImageError } from "./published-image-error"
import { readPublishedImage } from "./read-published-image.server"

type BlobOptions = {
  access: "public"
  addRandomSuffix: false
  allowOverwrite: false
  cacheControlMaxAge: number
  contentType: string
  abortSignal: AbortSignal
}

type BlobStorage = {
  put: (
    pathname: string,
    bytes: Buffer,
    options: BlobOptions
  ) => Promise<{ url: string; pathname: string; contentType: string }>
  head: (
    pathname: string,
    options: { abortSignal: AbortSignal }
  ) => Promise<{ url: string; pathname: string; contentType: string; size: number }>
}

export type HostPublishedImagesOptions = {
  snapshot: Record<string, unknown>
  revisionKey: string
  uploads: {
    read: (key: string) => Promise<string | null>
    save: (key: string, url: string) => Promise<void>
  }
  deadline: number
  blobHost: string
  /** New-object upload budget. Existing content-hash hits are still bounded by the deadline. */
  maxImages?: number
  now?: () => number
  fetch?: typeof fetch
  blob?: BlobStorage
}

type Context = {
  options: HostPublishedImagesOptions
  now: () => number
  request: typeof fetch
  storage: BlobStorage
  existing: Map<string, { url: string; size: number }>
}

class ImageDeadlineReached extends Error {}

function digest(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex")
}

function parseUrl(value: unknown) {
  if (typeof value !== "string" || value !== value.trim() || !/^https:\/\/[^/:?#]+\//.test(value)) return null
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return null
    return url
  } catch {
    return null
  }
}

function sourceUrl(value: unknown) {
  const url = parseUrl(value)
  return url?.hostname === "images-api.printify.com" && url.pathname.startsWith("/mockup/") ? url : null
}

function hostedLocation(value: unknown) {
  const url = parseUrl(value)
  if (!url || !isPublicBlobHost(url.hostname) || url.search) return null
  const match = /^\/published-mockups\/v1\/([a-f0-9]{64})\.(jpg|png|webp)$/.exec(url.pathname)
  if (!match) return null
  return {
    url,
    pathname: url.pathname.slice(1),
    hash: match[1]!,
    contentType: match[2] === "jpg" ? "image/jpeg" : `image/${match[2]}`,
  }
}

function ensureTime(context: Context) {
  if (context.now() + 1_500 >= context.options.deadline) throw new ImageDeadlineReached()
}

function signal(context: Context, timeout: number) {
  ensureTime(context)
  return AbortSignal.timeout(Math.max(1, Math.min(timeout, context.options.deadline - context.now() - 500)))
}

function storageError(error: unknown) {
  if (error instanceof PublishedImageError || error instanceof ImageDeadlineReached) return error
  const configuration =
    error instanceof BlobAccessError ||
    error instanceof BlobStoreNotFoundError ||
    error instanceof BlobStoreSuspendedError
  return new PublishedImageError(
    configuration ? "IMAGE_STORAGE_CONFIGURATION" : "IMAGE_STORAGE_UNAVAILABLE",
    !configuration
  )
}

async function existingImage(context: Context, pathname: string, size?: number) {
  const cached = context.existing.get(pathname)
  if (cached) {
    if (size !== undefined && cached.size !== size) throw new PublishedImageError("IMAGE_STORAGE_CONFLICT", false)
    return cached.url
  }
  try {
    const existing = await context.storage.head(pathname, { abortSignal: signal(context, 5_000) })
    const location = hostedLocation(existing.url)
    if (
      !location ||
      location.url.hostname !== context.options.blobHost ||
      location.pathname !== pathname ||
      existing.pathname !== pathname ||
      existing.contentType !== location.contentType ||
      !Number.isSafeInteger(existing.size) ||
      existing.size <= 0 ||
      existing.size > 16_000_000 ||
      (size !== undefined && existing.size !== size)
    ) {
      throw new PublishedImageError("IMAGE_STORAGE_CONFLICT", false)
    }
    context.existing.set(pathname, { url: existing.url, size: existing.size })
    return existing.url
  } catch (error) {
    if (error instanceof BlobNotFoundError) return null
    throw storageError(error)
  }
}

async function uploadImage(context: Context, source: string, expectedHash: string | undefined, canUpload: boolean) {
  const image = await readPublishedImage(source, { fetch: context.request, signal: signal(context, 10_000) })
  const checksum = digest(image.bytes)
  if (expectedHash && checksum !== expectedHash) throw new PublishedImageError("IMAGE_SOURCE_CHANGED", false)
  const pathname = `published-mockups/v1/${checksum}.${image.extension}`
  const existing = await existingImage(context, pathname, image.bytes.byteLength)
  if (existing) return { url: existing, uploaded: false }
  if (!canUpload) return null
  try {
    const result = await context.storage.put(pathname, image.bytes, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: 31_536_000,
      contentType: image.contentType,
      abortSignal: signal(context, 15_000),
    })
    const location = hostedLocation(result.url)
    if (
      !location ||
      location.url.hostname !== context.options.blobHost ||
      location.pathname !== pathname ||
      result.pathname !== pathname ||
      result.contentType !== image.contentType
    ) {
      throw new PublishedImageError("IMAGE_STORAGE_CONFIGURATION", false)
    }
    context.existing.set(pathname, { url: result.url, size: image.bytes.byteLength })
    return { url: result.url, uploaded: true }
  } catch (error) {
    const classified = storageError(error)
    if (!(classified instanceof PublishedImageError) || !classified.retryable) throw classified
  }
  // An upload response can be lost after storage commits. Verify bytes only in this uncertain case.
  const uploaded = await existingImage(context, pathname, image.bytes.byteLength)
  if (!uploaded) throw new PublishedImageError("IMAGE_STORAGE_UNAVAILABLE", true)
  let previous: Awaited<ReturnType<typeof readPublishedImage>>
  try {
    previous = await readPublishedImage(uploaded, { fetch: context.request, signal: signal(context, 10_000) })
  } catch (error) {
    if (error instanceof ImageDeadlineReached) throw error
    const invalid = error instanceof PublishedImageError && error.code === "IMAGE_CONTENT_INVALID"
    throw new PublishedImageError(invalid ? "IMAGE_STORAGE_CONFLICT" : "IMAGE_STORAGE_UNAVAILABLE", !invalid)
  }
  if (digest(previous.bytes) !== checksum) throw new PublishedImageError("IMAGE_STORAGE_CONFLICT", false)
  return { url: uploaded, uploaded: true }
}

export async function hostPublishedImages(
  options: HostPublishedImagesOptions
): Promise<{ snapshot: Record<string, unknown>; complete: boolean }> {
  if (!isPublicBlobHost(options.blobHost)) throw new PublishedImageError("IMAGE_STORAGE_CONFIGURATION", false)
  if (
    !options.revisionKey ||
    !Array.isArray(options.snapshot.images) ||
    !Number.isFinite(options.deadline) ||
    (options.maxImages !== undefined && !Number.isFinite(options.maxImages))
  ) {
    throw new PublishedImageError("IMAGE_SOURCE_INVALID", false)
  }
  const context: Context = {
    options,
    now: options.now ?? Date.now,
    request: options.fetch ?? fetch,
    storage: options.blob ?? { put, head },
    existing: new Map(),
  }
  const maxImages = Math.max(1, Math.min(10, Math.trunc(options.maxImages ?? 4)))
  const images = [...options.snapshot.images]
  const completed = new Map<string, string>()
  let uploaded = 0
  try {
    for (let index = 0; index < images.length; index++) {
      const image = images[index]
      if (!image || typeof image !== "object" || Array.isArray(image)) {
        throw new PublishedImageError("IMAGE_SOURCE_INVALID", false)
      }
      const src = "src" in image ? image.src : undefined
      const location = hostedLocation(src)
      if (location?.url.hostname === options.blobHost && (await existingImage(context, location.pathname))) continue
      const source = location ? sourceUrl("source_src" in image ? image.source_src : undefined) : sourceUrl(src)
      if (!source) throw new PublishedImageError("IMAGE_SOURCE_INVALID", false)
      let expectedHash = location?.hash
      const key = digest(JSON.stringify(["published-image-v1", options.blobHost, options.revisionKey, source.href]))
      let url = completed.get(key)
      if (!url) {
        let receipt: string | null
        ensureTime(context)
        try {
          receipt = await options.uploads.read(key)
        } catch {
          throw new PublishedImageError("IMAGE_RECEIPT_UNAVAILABLE", true)
        }
        if (receipt) {
          const saved = hostedLocation(receipt)
          if (!saved || saved.url.hostname !== options.blobHost) {
            throw new PublishedImageError("IMAGE_STORAGE_CONFIGURATION", false)
          }
          if (expectedHash && saved.hash !== expectedHash) throw new PublishedImageError("IMAGE_SOURCE_CHANGED", false)
          expectedHash = saved.hash
          url = (await existingImage(context, saved.pathname)) ?? undefined
        }
      }
      if (!url) {
        const result = await uploadImage(context, source.href, expectedHash, uploaded < maxImages)
        if (!result) return { snapshot: { ...options.snapshot, images }, complete: false }
        url = result.url
        ensureTime(context)
        try {
          await options.uploads.save(key, url)
        } catch {
          throw new PublishedImageError("IMAGE_RECEIPT_UNAVAILABLE", true)
        }
        if (result.uploaded) uploaded++
      }
      if (expectedHash && hostedLocation(url)?.hash !== expectedHash) {
        throw new PublishedImageError("IMAGE_SOURCE_CHANGED", false)
      }
      completed.set(key, url)
      // The catalog schema strips source_src; this provenance stays in the private publication snapshot.
      images[index] = { ...image, src: url, source_src: source.href }
    }
    return { snapshot: { ...options.snapshot, images }, complete: true }
  } catch (error) {
    if (error instanceof ImageDeadlineReached) return { snapshot: { ...options.snapshot, images }, complete: false }
    throw error
  }
}
