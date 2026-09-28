import "server-only"

import { env } from "@/lib/env"

import { listStorefrontProductIds } from "./list-storefront-product-ids.server"
import { PublishedSnapshotRejectedError } from "./published-snapshot-rejected-error"
import { readStorefrontProduct } from "./read-storefront-product.server"

export async function getSitemapProductIds(): Promise<string[]> {
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
  return ids.filter((_, index) => snapshots[index] !== null)
}
