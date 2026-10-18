import "server-only"

import { readCatalogStock } from "@/features/catalog-sync/read-catalog-stock.server"
import { normalizeCatalogProduct } from "@/features/catalog/normalize-catalog-product"
import type { GarmentFeedProfile } from "@/features/garment-catalog/garment-feed-profile-schema"
import { getPublishingStore } from "@/features/publishing/get-publishing-store.server"
import { listShownProducts } from "@/features/publishing/list-shown-products.server"
import { env } from "@/lib/env"
import { getSiteUrl } from "@/lib/get-site-url"
import { isPublishedVariantAvailable } from "@/lib/printify/is-published-variant-available"

import { MerchantFeedError } from "./merchant-feed-error"
import type { MerchantProduct } from "./merchant-product"
import { prepareMerchantProduct } from "./prepare-merchant-product.server"

export async function getMerchantProducts(): Promise<MerchantProduct[]> {
  if (
    !env.PRINTIFY_PUBLISHING_ENABLED ||
    !env.DATABASE_URL ||
    !env.PRINTIFY_SHOP_ID ||
    !/^[1-9]\d*$/.test(env.PRINTIFY_SHOP_ID)
  )
    throw new MerchantFeedError("CONFIGURATION_INVALID")
  try {
    let galleries: Awaited<ReturnType<typeof listShownProducts>>
    let profiles: ReadonlyMap<number, GarmentFeedProfile>
    try {
      galleries = await listShownProducts()
      if (!galleries.length) return []
      profiles = await getPublishingStore().garments.listFeedProfiles()
    } catch {
      throw new MerchantFeedError("DATABASE_UNAVAILABLE")
    }
    const published = galleries.map(({ snapshot, withheldVariantIds, diagnostic, staleColors }) => {
      if (withheldVariantIds.length) {
        console.warn("Product gallery variants withheld from merchant feeds", {
          productId: new MerchantFeedError("UNKNOWN_ERROR", snapshot.id).productId,
          codes: [...(diagnostic ? ["GALLERY_INVALID"] : []), ...(staleColors.length ? ["GALLERY_STALE"] : [])],
          withheldVariantCount: withheldVariantIds.length,
        })
      }
      return prepareMerchantProduct(snapshot, env.PRINTIFY_SHOP_ID!, getSiteUrl(), profiles, withheldVariantIds)
    })
    const seen = new Set<string>()
    for (const { display } of published) {
      if (seen.has(display.id.toLowerCase())) throw new MerchantFeedError("INVALID_PRODUCT_ID", display.id)
      seen.add(display.id.toLowerCase())
    }
    const observations = await readCatalogStock(galleries.map((gallery) => gallery.snapshot))
    // Preserve the destination's previous feed during an outage instead of claiming every item sold out.
    if (!observations) throw new MerchantFeedError("STOCK_UNAVAILABLE")
    return (
      published
        // A product whose every variant has a withheld curated color leaves the feed instead of failing it.
        .filter(
          ({ display, merchantProduct }) =>
            Object.hasOwn(observations, display.id) && merchantProduct.product.variants.length > 0
        )
        .map(({ display, production, merchantProduct }) => {
          const current = new Map(observations[display.id]!.map((variant) => [variant.id, variant]))
          const saved = new Map(production.variants.map((variant) => [variant.id, variant]))
          return {
            ...merchantProduct,
            product: normalizeCatalogProduct({
              ...display,
              variants: display.variants.map((variant) => ({
                ...variant,
                is_available:
                  saved.has(variant.id) && isPublishedVariantAvailable(saved.get(variant.id)!, current.get(variant.id)),
              })),
            }),
          }
        })
    )
  } catch (error) {
    throw error instanceof MerchantFeedError ? error : new MerchantFeedError("UNKNOWN_ERROR")
  }
}
