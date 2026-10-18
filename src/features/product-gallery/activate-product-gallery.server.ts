import "server-only"
import { refreshStorefront } from "@/features/design-of-the-week/refresh-storefront.server"
import { env } from "@/lib/env"
import { putPublishedImage } from "@/features/publishing/put-published-image.server"
import { PublishedImageError } from "@/features/publishing/published-image-error"
import { GalleryError } from "./gallery-error"
import { getProductGalleryStore } from "./get-product-gallery-store.server"
import { readGalleryPhoto } from "./read-gallery-photo.server"
import { readGalleryImageLocation } from "./read-gallery-image-location"
import type { GalleryActivation } from "./gallery-mutation-schema"

export async function activateProductGallery(product: string, input: GalleryActivation, actor: string) {
  const host = env.NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST
  if (!host)
    throw new GalleryError("Configure public photo storage before activation.", 409, "PHOTO_STORAGE_CONFIGURATION")
  const store = getProductGalleryStore(),
    deadline = Date.now() + 40000
  const plan = await store.activationPlan(product, input)
  const ids = [
    ...new Set(
      plan.manifest.colors.flatMap((c) => c.entries.flatMap((e) => (e.source === "store" ? [e.assetId] : [])))
    ),
  ]
  // The Blob SDK authenticates public writes with a legacy token or the connected store via Vercel OIDC.
  if (ids.length && !env.BLOB_READ_WRITE_TOKEN && !env.BLOB_STORE_ID)
    throw new GalleryError("Configure public photo storage before activation.", 409, "PHOTO_STORAGE_CONFIGURATION")
  let completed = 0,
    cursor = 0
  const workers = await Promise.allSettled(
    Array.from({ length: 2 }, async () => {
      while (cursor < ids.length && Date.now() < deadline - 18000) {
        const id = ids[cursor++]!,
          asset = plan.assets.find((a) => a.id === id)
        const label = plan.photoLabels[id] ?? "A selected photo"
        if (!asset)
          throw new GalleryError(
            `${label}: this photo no longer belongs to the product. Choose an uploaded photo from this product.`,
            409,
            "PHOTO_OWNERSHIP"
          )
        try {
          const receipt = await store.promotion(product, asset, host)
          if (
            receipt &&
            receipt.sha256 === asset.sha256 &&
            readGalleryImageLocation(receipt.url, host, "store")?.sha256 === asset.sha256
          ) {
            completed++
            continue
          }
          const bytes = await readGalleryPhoto(asset),
            pathname = `published-product-photos/v1/${asset.sha256}.jpg`
          const url = await putPublishedImage({
            pathname,
            bytes,
            contentType: "image/jpeg",
            blobHost: host,
            signal: (timeout) => AbortSignal.timeout(timeout),
            timeouts: { put: 7000, head: 3000, read: 3000 },
          })
          await store.recordPromotion(product, asset, host, url)
          completed++
        } catch (error) {
          if (error instanceof GalleryError)
            throw new GalleryError(`${label}: ${error.message}`, error.status, error.code)
          if (error instanceof PublishedImageError && !error.retryable) {
            if (error.code === "IMAGE_STORAGE_CONFIGURATION")
              throw new GalleryError(
                `${label}: public photo storage is not configured or accessible. Check its token and store before activation.`,
                409,
                "PHOTO_STORAGE_CONFIGURATION"
              )
            throw new GalleryError(
              `${label}: the public copy conflicts with the verified original. Repair or migrate image storage before activation; retrying this photo alone cannot fix it.`,
              409,
              "PHOTO_STORAGE_CONFLICT"
            )
          }
          throw error
        }
      }
    })
  )
  const failure =
    workers.find((result) => result.status === "rejected" && result.reason instanceof GalleryError) ??
    workers.find((result) => result.status === "rejected")
  if (failure?.status === "rejected") {
    throw failure.reason
  }
  if (completed < ids.length) return { status: "preparing" as const, completed, total: ids.length }
  const result = await store.activate(product, input, actor, host)
  let cacheRefreshed = true
  try {
    refreshStorefront()
  } catch {
    cacheRefreshed = false
  }
  return { status: "activated" as const, ...result, cacheRefreshed }
}
