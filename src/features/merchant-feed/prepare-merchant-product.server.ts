import "server-only"

import { catalogProductSchema } from "@/features/catalog/catalog-product-schema"
import { normalizeCatalogProduct } from "@/features/catalog/normalize-catalog-product"
import type { GarmentFeedProfile } from "@/features/garment-catalog/garment-feed-profile-schema"
import { parsePrintifyProduct } from "@/lib/printify/parse-printify-product"

import { resolveGoogleMerchantCopy } from "./resolve-google-merchant-copy"
import { createMerchantFeed } from "./create-merchant-feed"
import { MerchantFeedError } from "./merchant-feed-error"
import type { MerchantProduct } from "./merchant-product"

export function prepareMerchantProduct(
  snapshot: Record<string, unknown>,
  shopId: string,
  siteUrl: URL,
  profiles: ReadonlyMap<number, GarmentFeedProfile>
) {
  const parsed = catalogProductSchema.safeParse(snapshot)
  if (!parsed.success) throw new MerchantFeedError("SNAPSHOT_DISPLAY_INVALID", snapshot.id)
  const display = parsed.data
  if (snapshot.visible === false) throw new MerchantFeedError("SNAPSHOT_HIDDEN", display.id)
  const apparel = typeof snapshot.blueprint_id === "number" ? profiles.get(snapshot.blueprint_id) : undefined
  if (!apparel) throw new MerchantFeedError("UNSUPPORTED_BLUEPRINT", display.id)
  const production = parsePrintifyProduct(snapshot, { productId: display.id, shopId })
  if (!production) throw new MerchantFeedError("SNAPSHOT_PRODUCTION_INVALID", display.id)
  const merchantProduct: MerchantProduct = {
    product: normalizeCatalogProduct(display),
    apparel,
  }
  const copy = resolveGoogleMerchantCopy(snapshot.google_merchant_copy, merchantProduct.product, production, apparel)
  merchantProduct.googleCopy = copy.variants
  for (const issue of copy.issues) {
    if (issue.code === "MISSING" || issue.code === "UNCOVERED_VARIANT") continue
    console.warn("Google merchant copy inactive", {
      code: issue.code,
      productId: new MerchantFeedError("UNKNOWN_ERROR", display.id).productId,
      ...(issue.variantId !== undefined ? { variantId: issue.variantId } : {}),
    })
  }
  // Run the actual output constraints before stock reads, including every color's mockup.
  createMerchantFeed([merchantProduct], siteUrl)
  return { display, production, merchantProduct }
}
