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
  /** When the product most recently entered the shop; null when the publication carries no stamp. */
  lastModified: string | null
  /** The product's default photo, already limited to public https sources. */
  image: string | null
}

/** Every product a crawler may list: the sitemap, llms.txt and the shop ItemList share this membership. */
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
        lastModified: product.addedToShopAt,
        image: product.image?.src ?? null,
      },
    ]
  })
}
