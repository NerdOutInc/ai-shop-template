import "server-only"
import { env } from "@/lib/env"
import { resolveProductGallery } from "./resolve-product-gallery.server"

export type GalleryDisplayRow = {
  snapshot: Record<string, unknown>
  revision: string
  gallery_active: unknown
  gallery_history: Record<string, Record<string, unknown>>
}
export function applyGalleryDisplay(row: GalleryDisplayRow) {
  return resolveProductGallery({
    snapshot: row.snapshot,
    revision: row.revision,
    active: row.gallery_active,
    history: row.gallery_history,
    blobHost: env.NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST,
  })
}
