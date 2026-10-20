import "server-only"

import { env } from "@/lib/env"

import { displayProductTitle } from "./display-product-title"
import { listStorefrontProductIds } from "./list-storefront-product-ids.server"
import { normalizeCatalogProduct } from "./normalize-catalog-product"
import { PublishedSnapshotRejectedError } from "./published-snapshot-rejected-error"
import { readStorefrontProduct } from "./read-storefront-product.server"

export type SitemapProduct = {
  id: string
  title: string
  /**
   * The later of the product's last publication or image write and its most recent shop arrival,
   * so a republished page and a reveal both move the date; null when neither stamp is known.
   */
  lastModified: string | null
  /** The product's default photo, already limited to public https sources. */
  image: string | null
}

/** Every product a crawler may list: the sitemap, llms.txt and the shop ItemList share this membership. */
function lastModified(product: { addedToShopAt: string | null }, snapshot: Record<string, unknown>) {
  const stamps = [product.addedToShopAt, snapshot.storefront_updated_at]
    .filter((value): value is string => typeof value === "string")
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value))
  return stamps.length ? new Date(Math.max(...stamps)).toISOString() : null
}

export async function getSitemapProducts(): Promise<SitemapProduct[]> {
  if (!env.PRINTIFY_PUBLISHING_ENABLED) throw new Error("Published catalog is not enabled")
  const ids = await listStorefrontProductIds()
  const snapshots = await Promise.all(
    ids.map(async (id) => {
      try {
        return await readStorefrontProduct(id)
      } catch (error) {
        // A known-invalid publication is withheld; an unknown storage failure must not look like removal.
        if (error instanceof PublishedSnapshotRejectedError) return null
        throw error
      }
    })
  )
  // A product can also be hidden between the membership and snapshot reads.
  return snapshots.flatMap((snapshot) => {
    if (!snapshot) return []
    const product = normalizeCatalogProduct(snapshot)
    return [
      {
        id: product.id,
        title: displayProductTitle(product.title),
        lastModified: lastModified(product, snapshot),
        image: product.image?.src ?? null,
      },
    ]
  })
}
