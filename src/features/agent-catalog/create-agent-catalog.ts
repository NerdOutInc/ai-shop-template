import type { CatalogProduct } from "@/features/catalog/catalog-product"
import { displayProductTitle } from "@/features/catalog/display-product-title"
import { getProductVariantListings } from "@/features/catalog/get-product-variant-listings"
import { displayColorName } from "@/lib/display-color-name"
import { storeConfig } from "@/lib/store-config"

import type { AgentCatalog, AgentCatalogProduct } from "./agent-catalog"

export type AgentCatalogSource = { product: CatalogProduct; category: string | null }

function money(cents: number) {
  return (cents / 100).toFixed(2)
}

export function createAgentCatalog(sources: readonly AgentCatalogSource[], siteUrl: URL): AgentCatalog {
  const products = sources.flatMap(({ product, category }): AgentCatalogProduct[] => {
    // The same listing rule as the Product JSON-LD and merchant feeds: only options a page can preselect.
    const listings = getProductVariantListings(product, siteUrl)
    if (!listings.length) return []
    return [
      {
        id: product.id,
        url: new URL(`/shop/${encodeURIComponent(product.id)}`, siteUrl).href,
        title: displayProductTitle(product.title),
        description: product.description.trim(),
        brand: storeConfig.name,
        category,
        images: [...new Set(listings.flatMap((variant) => variant.images))],
        priceRange: product.price
          ? { min: money(product.price.min), max: money(product.price.max), currency: product.price.currency }
          : null,
        colors: [...new Set(listings.map((variant) => displayColorName(variant.color)))],
        sizes: [...new Set(listings.map((variant) => variant.size))],
        variants: listings.map((variant) => ({
          id: variant.id,
          sku: `${product.id}-${variant.id}`,
          color: displayColorName(variant.color),
          size: variant.size,
          price: money(variant.price),
          currency: variant.currency,
          available: variant.available,
          url: variant.url,
          images: variant.images,
        })),
      },
    ]
  })
  return {
    store: {
      name: storeConfig.name,
      description: storeConfig.description,
      url: new URL("/", siteUrl).href,
      currency: "USD",
      shippingPolicyUrl: new URL("/shipping", siteUrl).href,
      returnPolicyUrl: new URL("/returns", siteUrl).href,
      privacyUrl: new URL("/privacy", siteUrl).href,
    },
    products,
  }
}
