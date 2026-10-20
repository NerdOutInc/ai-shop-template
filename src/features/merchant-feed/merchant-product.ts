import type { ResolvedGoogleCopy } from "./resolve-google-merchant-copy"
import type { CatalogProduct } from "@/features/catalog/catalog-product"
import type { GarmentFeedProfile } from "@/features/garment-catalog/garment-feed-profile-schema"

export type MerchantProduct = {
  product: CatalogProduct
  apparel: GarmentFeedProfile
  /** The garment the apparel profile was read for; the agent catalog resolves its display category by it. */
  blueprintId: number
  googleCopy?: ReadonlyMap<number, ResolvedGoogleCopy>
}
