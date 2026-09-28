import "server-only"

import { hostPublishedImages } from "./host-published-images.server"
import { PublishedImageError } from "./published-image-error"
import type { PublishingStore } from "./publishing-store"

type Services = {
  store: Pick<PublishingStore, "withProductLock"> & { listProductIds: () => Promise<string[]> }
  shopId: string
  blobHost: string
  invalidate: () => void
  now?: () => number
  hostImages?: typeof hostPublishedImages
}

type Selection = { productId?: string; afterProductId?: string; limit?: number }
type Outcome = "updated" | "unchanged" | "partial" | "skipped" | "failed"
type Failure = {
  productId: string
  code: PublishedImageError["code"] | "IMAGE_BACKFILL_UNKNOWN"
  disposition: "retry" | "review"
}
type CacheInvalidation =
  | { status: "not-needed" | "complete" }
  | { status: "failed"; code: "IMAGE_CACHE_INVALIDATION_FAILED"; disposition: "retry" }

export async function backfillPublishedImages(services: Services, selection: Selection = {}) {
  const limit = selection.limit ?? 5
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 5 ||
    (selection.productId && selection.afterProductId) ||
    [selection.productId, selection.afterProductId].some((value) => value && !/^[a-f\d]{24}$/.test(value)) ||
    !/^[1-9]\d*$/.test(services.shopId)
  )
    throw new Error("Invalid image backfill selection")
  const now = services.now ?? Date.now
  const deadline = now() + 40_000
  const hostImages = services.hostImages ?? hostPublishedImages
  const ids = selection.productId
    ? [selection.productId]
    : (await services.store.listProductIds())
        .sort()
        .filter((id) => !selection.afterProductId || id > selection.afterProductId)
  const products: Record<Outcome, string[]> = { updated: [], unchanged: [], partial: [], skipped: [], failed: [] }
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
          const hosted = await hostImages({
            snapshot: current.snapshot,
            revisionKey: `backfill:${services.shopId}:${productId}:${current.revision}`,
            uploads: record.imageUploads,
            deadline,
            blobHost: services.blobHost,
            now,
            maxImages: 10,
          })
          if (!hosted.complete) return "partial"
          if (!Array.isArray(hosted.snapshot.images)) throw new Error("Invalid hosted image result")
          if (JSON.stringify(hosted.snapshot.images) === JSON.stringify(current.snapshot.images)) {
            return "unchanged"
          }
          if (!(await record.replaceProductImages(current.revision, hosted.snapshot.images))) return "skipped"
          return "updated"
        })) ?? "skipped"
    } catch (error) {
      const failure: Failure = {
        productId,
        code: error instanceof PublishedImageError ? error.code : "IMAGE_BACKFILL_UNKNOWN",
        disposition: error instanceof PublishedImageError && error.retryable ? "retry" : "review",
      }
      failures.push(failure)
      console.warn("Published image backfill needs retry or review", failure)
    }
    products[outcome].push(productId)
    visited++
    lastProductId = productId
  }
  let cacheInvalidation: CacheInvalidation = { status: "not-needed" }
  if (products.updated.length || products.unchanged.length) {
    try {
      // Also recover earlier commits interrupted before invalidation, once per batch.
      services.invalidate()
      cacheInvalidation = { status: "complete" }
    } catch {
      cacheInvalidation = {
        status: "failed",
        code: "IMAGE_CACHE_INVALIDATION_FAILED",
        disposition: "retry",
      }
      console.warn("Published image backfill cache refresh needs retry", cacheInvalidation)
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
      partial: products.partial.length,
      skipped: products.skipped.length,
      failed: products.failed.length,
    },
    nextAfterProductId:
      !selection.productId && visited < ids.length ? (lastProductId ?? selection.afterProductId ?? null) : null,
    hasMore: visited < ids.length,
  }
}
