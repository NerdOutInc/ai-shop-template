import type { ResolvedGoogleCopy } from "./resolve-google-merchant-copy"
import type { CatalogProduct } from "@/features/catalog/catalog-product"
import type { GarmentFeedProfile } from "@/features/garment-catalog/garment-feed-profile-schema"

export type MerchantProduct = {
  product: CatalogProduct
  apparel: GarmentFeedProfile
  googleCopy?: ReadonlyMap<number, ResolvedGoogleCopy>
}
