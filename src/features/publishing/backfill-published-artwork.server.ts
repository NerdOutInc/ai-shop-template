import "server-only"

import { catalogProductSchema } from "@/features/catalog/catalog-product-schema"
import { productArtworkFingerprint } from "@/features/design-products/product-artwork-fingerprint"
import { readPublicArtworkLocation } from "@/lib/read-public-artwork-location"

import { hostPublishedArtwork, type HostPublishedArtworkOptions } from "./host-published-artwork.server"
import { publishedArtworkSchema } from "./published-artwork-schema"
import { PublishedImageError } from "./published-image-error"
import type { PublishingStore } from "./publishing-store"

type Services = {
  store: Pick<PublishingStore, "withProductLock"> & { listProductIds: () => Promise<string[]> }
  shopId: string
  blobHost: string
  readApproved: (
    input: Parameters<HostPublishedArtworkOptions["readApproved"]>[0] & {
      source: Record<string, unknown>
      deadline: number
    }
  ) => ReturnType<HostPublishedArtworkOptions["readApproved"]>
  readAsset: HostPublishedArtworkOptions["readAsset"]
  invalidate: () => void | Promise<void>
  now?: () => number
  hostArtwork?: typeof hostPublishedArtwork
}

type Selection = { productId?: string; afterProductId?: string; limit?: number }
type Outcome = "updated" | "unchanged" | "unmatched" | "partial" | "skipped" | "failed"
type Failure = {
  productId: string
  code: Exclude<PublishedImageError["code"], "ARTWORK_NOT_RESOLVED"> | "ARTWORK_BACKFILL_UNKNOWN"
  disposition: "retry" | "review"
}
type CacheInvalidation =
  | { status: "not-needed" | "complete" }
  | { status: "failed"; code: "ARTWORK_CACHE_INVALIDATION_FAILED"; disposition: "retry" }

function hasArtwork(snapshot: Record<string, unknown>) {
  if (snapshot.storefront_artwork_enabled !== true) return false
  return Boolean(catalogProductSchema.shape.storefront_artwork.parse(snapshot.storefront_artwork))
}

/** Repairs only the artwork fields of a frozen publication; provider drafts and callbacks are not involved. */
export async function backfillPublishedArtwork(services: Services, selection: Selection = {}) {
  const limit = selection.limit ?? 5
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 5 ||
    (selection.productId && selection.afterProductId) ||
    [selection.productId, selection.afterProductId].some((value) => value && !/^[a-f\d]{24}$/.test(value)) ||
    !/^[1-9]\d*$/.test(services.shopId)
  )
    throw new Error("Invalid artwork backfill selection")
  const now = services.now ?? Date.now
  const deadline = now() + 40_000
  const hostArtwork = services.hostArtwork ?? hostPublishedArtwork
  const ids = selection.productId
    ? [selection.productId]
    : (await services.store.listProductIds())
        .sort()
        .filter((id) => !selection.afterProductId || id > selection.afterProductId)
  const products: Record<Outcome, string[]> = {
    updated: [],
    unchanged: [],
    unmatched: [],
    partial: [],
    skipped: [],
    failed: [],
  }
  const failures: Failure[] = []
  let visited = 0
  let lastProductId: string | null = null
  for (const productId of ids.slice(0, limit)) {
    if (now() >= deadline - 3_000) break
    let outcome: Outcome = "failed"
    try {
      outcome =
        (await services.store.withProductLock(productId, async (record): Promise<Outcome> => {
          const current = await record.getImageBackfill()
          if (!current) return "skipped"
          if (hasArtwork(current.snapshot)) return "unchanged"
          const expected = { shopId: services.shopId, productId }
          const fingerprint = productArtworkFingerprint(current.snapshot, expected)
          if (!fingerprint) throw new PublishedImageError("IMAGE_SOURCE_INVALID", false)
          const hosted = await hostArtwork({
            snapshot: current.snapshot,
            source: current.snapshot,
            expected,
            revisionKey: `artwork-backfill:${services.shopId}:${productId}:${current.revision}`,
            uploads: record.imageUploads,
            deadline,
            blobHost: services.blobHost,
            now,
            readApproved: (input) => services.readApproved({ ...input, source: current.snapshot, deadline }),
            readAsset: services.readAsset,
          })
          if (!hosted.complete) return "partial"
          if (!hosted.snapshot.storefront_artwork || hosted.snapshot.storefront_artwork_enabled !== true)
            return "unmatched"
          const artwork = publishedArtworkSchema.safeParse(hosted.snapshot.storefront_artwork)
          if (
            !artwork.success ||
            artwork.data.productionFingerprint !== fingerprint ||
            readPublicArtworkLocation(artwork.data.src)?.hostname !== services.blobHost
          )
            throw new PublishedImageError("IMAGE_SOURCE_CHANGED", false)
          if (!(await record.replaceProductArtwork(current.revision, artwork.data))) return "skipped"
          return "updated"
        })) ?? "skipped"
    } catch (error) {
      const code = error instanceof PublishedImageError ? error.code : "ARTWORK_BACKFILL_UNKNOWN"
      if (code === "ARTWORK_NOT_RESOLVED") {
        // Publication must fail closed, but an unmatched source is an expected backfill outcome.
        outcome = "unmatched"
      } else {
        const failure: Failure = {
          productId,
          code,
          disposition: error instanceof PublishedImageError && error.retryable ? "retry" : "review",
        }
        failures.push(failure)
        console.warn("Published artwork backfill needs retry or review", failure)
      }
    }
    products[outcome].push(productId)
    visited++
    lastProductId = productId
  }
  let cacheInvalidation: CacheInvalidation = { status: "not-needed" }
  if (products.updated.length || products.unchanged.length) {
    try {
      // A completed repair can be retried to recover an interrupted cache refresh without a new revision.
      await services.invalidate()
      cacheInvalidation = { status: "complete" }
    } catch {
      cacheInvalidation = { status: "failed", code: "ARTWORK_CACHE_INVALIDATION_FAILED", disposition: "retry" }
      console.warn("Published artwork backfill cache refresh needs retry", cacheInvalidation)
    }
  }
  return {
    mode: "apply" as const,
    products,
    failures,
    cacheInvalidation,
    counts: {
      updated: products.updated.length,
      unchanged: products.unchanged.length,
      unmatched: products.unmatched.length,
      partial: products.partial.length,
      skipped: products.skipped.length,
      failed: products.failed.length,
    },
    nextAfterProductId:
      !selection.productId && visited < ids.length ? (lastProductId ?? selection.afterProductId ?? null) : null,
    hasMore: visited < ids.length,
  }
}
