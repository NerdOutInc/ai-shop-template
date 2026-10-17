import "server-only"

import { createHash } from "node:crypto"
import type { CatalogProduct } from "@/features/catalog/catalog-product"
import type { GarmentFeedProfile } from "@/features/garment-catalog/garment-feed-profile-schema"

export function googleCopySharedFactsHash(product: CatalogProduct, apparel: GarmentFeedProfile) {
  return createHash("sha256")
    .update(JSON.stringify([product.title, product.description, apparel.gender, apparel.ageGroup]))
    .digest("hex")
}
