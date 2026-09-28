import type { CatalogProduct } from "@/features/catalog/catalog-product"
import type { GarmentFeedProfile } from "@/features/garment-catalog/garment-feed-profile-schema"

export type MerchantProduct = {
  product: CatalogProduct
  apparel: GarmentFeedProfile
}
