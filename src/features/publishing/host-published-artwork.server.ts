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

import type { LibraryStoredAsset } from "@/features/design-library/library-types"
import { productArtworkFingerprint } from "@/features/design-products/product-artwork-fingerprint"
import { readBoundedArtworkStream } from "@/features/design-library/read-bounded-artwork-stream.server"
import { isPublicBlobHost } from "@/lib/is-public-blob-host"
import { readPublicArtworkLocation } from "@/lib/read-public-artwork-location"

import { derivePublishedArtwork } from "./derive-published-artwork.server"
import { PublishedImageError } from "./published-image-error"
import type { PublishingRecord } from "./publishing-store"

type ApprovedArtwork = { revisionId: string; productionFingerprint: string; printAsset: LibraryStoredAsset }
type BlobStorage = {
  head: (
    pathname: string,
    options: { abortSignal: AbortSignal }
  ) => Promise<{ url: string; pathname: string; contentType: string; size: number }>
  put: (
    pathname: string,
    bytes: Buffer,
    options: {
      access: "public"
      addRandomSuffix: false
      allowOverwrite: false
      cacheControlMaxAge: number
      contentType: string
      abortSignal: AbortSignal
    }
  ) => Promise<{ url: string; pathname: string; contentType: string }>
}

export type HostPublishedArtworkOptions = {
  snapshot: Record<string, unknown>
  source: Record<string, unknown>
  expected: { shopId: string; productId: string }
  revisionKey: string
  uploads: PublishingRecord["imageUploads"]
  deadline: number
  blobHost: string
  readApproved: (input: {
    shopId: string
    productId: string
    productionFingerprint: string
  }) => Promise<ApprovedArtwork | null>
  readAsset: (asset: LibraryStoredAsset, options: { signal: AbortSignal }) => Promise<ReadableStream<Uint8Array> | null>
  blob?: BlobStorage
  now?: () => number
  fetch?: typeof fetch
}

class ArtworkDeadlineReached extends Error {}

function storageError(error: unknown) {
  if (error instanceof PublishedImageError || error instanceof ArtworkDeadlineReached) return error
  const configuration =
    error instanceof BlobAccessError ||
    error instanceof BlobStoreNotFoundError ||
    error instanceof BlobStoreSuspendedError
  return new PublishedImageError(
    configuration ? "IMAGE_STORAGE_CONFIGURATION" : "IMAGE_STORAGE_UNAVAILABLE",
    !configuration
  )
}

export async function hostPublishedArtwork(
  options: HostPublishedArtworkOptions
): Promise<{ snapshot: Record<string, unknown>; complete: boolean }> {
  if (!isPublicBlobHost(options.blobHost)) throw new PublishedImageError("IMAGE_STORAGE_CONFIGURATION", false)
  if (!options.revisionKey || !Number.isFinite(options.deadline))
    throw new PublishedImageError("IMAGE_SOURCE_INVALID", false)
  const now = options.now ?? Date.now
  const storage = options.blob ?? { put, head }
  const signal = (limit: number) => {
    const remaining = options.deadline - now() - 500
    if (remaining < 1500) throw new ArtworkDeadlineReached()
    return AbortSignal.timeout(Math.min(limit, remaining))
  }
  try {
    signal(1000)
    const fingerprint = productArtworkFingerprint(options.source, options.expected)
    if (!fingerprint || productArtworkFingerprint(options.snapshot, options.expected) !== fingerprint)
      throw new PublishedImageError("IMAGE_SOURCE_CHANGED", false)
    const approved = await options.readApproved({ ...options.expected, productionFingerprint: fingerprint })
    if (!approved) throw new PublishedImageError("ARTWORK_NOT_RESOLVED", false)
    if (
      approved.productionFingerprint !== fingerprint ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(approved.revisionId)
    )
      throw new PublishedImageError("IMAGE_SOURCE_CHANGED", false)
    const stream = await options.readAsset(approved.printAsset, { signal: signal(10_000) })
    if (!stream || !approved.printAsset.bytes) throw new PublishedImageError("IMAGE_SOURCE_UNAVAILABLE", true)
    const bytes = await readBoundedArtworkStream(stream, approved.printAsset.bytes)
    // Leave time for storage and the receipt; spend the remaining worker budget on decoding/encoding.
    const encodeSeconds = Math.floor((options.deadline - now() - 6000) / 1000)
    if (encodeSeconds < 1) throw new ArtworkDeadlineReached()
    const derivative = await derivePublishedArtwork(bytes, approved.printAsset, encodeSeconds)
    const pathname = `published-artwork/v1/${derivative.sha256}.webp`
    const key = createHash("sha256")
      .update(
        JSON.stringify([
          "published-artwork-v1",
          options.blobHost,
          options.revisionKey,
          approved.revisionId,
          fingerprint,
          approved.printAsset.sha256,
        ])
      )
      .digest("hex")
    let receipt: string | null
    try {
      receipt = await options.uploads.read(key)
    } catch {
      throw new PublishedImageError("IMAGE_RECEIPT_UNAVAILABLE", true)
    }
    if (receipt) {
      const location = readPublicArtworkLocation(receipt)
      if (!location || location.hostname !== options.blobHost || location.pathname !== pathname)
        throw new PublishedImageError("IMAGE_STORAGE_CONFLICT", false)
    }
    async function existing() {
      try {
        const object = await storage.head(pathname, { abortSignal: signal(5000) })
        const location = readPublicArtworkLocation(object.url)
        if (
          !location ||
          location.hostname !== options.blobHost ||
          location.pathname !== pathname ||
          object.pathname !== pathname ||
          object.contentType !== "image/webp" ||
          object.size !== derivative.bytes.length
        )
          throw new PublishedImageError("IMAGE_STORAGE_CONFLICT", false)
        return object.url
      } catch (error) {
        if (error instanceof BlobNotFoundError) return null
        throw storageError(error)
      }
    }
    let url = await existing()
    if (!url) {
      try {
        const uploaded = await storage.put(pathname, derivative.bytes, {
          access: "public",
          addRandomSuffix: false,
          allowOverwrite: false,
          cacheControlMaxAge: 31_536_000,
          contentType: "image/webp",
          abortSignal: signal(10_000),
        })
        const location = readPublicArtworkLocation(uploaded.url)
        if (
          !location ||
          location.hostname !== options.blobHost ||
          location.pathname !== pathname ||
          uploaded.pathname !== pathname ||
          uploaded.contentType !== "image/webp"
        )
          throw new PublishedImageError("IMAGE_STORAGE_CONFIGURATION", false)
        url = uploaded.url
      } catch (error) {
        const classified = storageError(error)
        if (!(classified instanceof PublishedImageError) || !classified.retryable) throw classified
        url = await existing()
        if (!url) throw classified
        // The PUT may have committed before its response was lost. Compare the public derivative bytes.
        let response: Response
        try {
          response = await (options.fetch ?? fetch)(url, { cache: "no-store", redirect: "error", signal: signal(5000) })
        } catch (error) {
          throw storageError(error)
        }
        if (!response.ok || !response.body) {
          void response.body?.cancel().catch(() => undefined)
          throw new PublishedImageError("IMAGE_STORAGE_UNAVAILABLE", true)
        }
        let recovered: Buffer
        try {
          recovered = await readBoundedArtworkStream(response.body, derivative.bytes.length)
        } catch (error) {
          const invalidSize = error instanceof Error && /byte count|incomplete|supported size/.test(error.message)
          throw new PublishedImageError(
            invalidSize ? "IMAGE_STORAGE_CONFLICT" : "IMAGE_STORAGE_UNAVAILABLE",
            !invalidSize
          )
        }
        if (createHash("sha256").update(recovered).digest("hex") !== derivative.sha256)
          throw new PublishedImageError("IMAGE_STORAGE_CONFLICT", false)
      }
    }
    signal(1000)
    try {
      await options.uploads.save(key, url)
    } catch {
      throw new PublishedImageError("IMAGE_RECEIPT_UNAVAILABLE", true)
    }
    return {
      snapshot: {
        ...options.snapshot,
        storefront_artwork_enabled: true,
        storefront_artwork: {
          src: url,
          revisionId: approved.revisionId,
          productionFingerprint: fingerprint,
          sourceSha256: approved.printAsset.sha256,
          sha256: derivative.sha256,
          width: derivative.width,
          height: derivative.height,
        },
      },
      complete: true,
    }
  } catch (error) {
    if (error instanceof ArtworkDeadlineReached) return { snapshot: options.snapshot, complete: false }
    throw error
  }
}
