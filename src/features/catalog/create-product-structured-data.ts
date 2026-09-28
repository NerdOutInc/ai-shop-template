import { storeConfig } from "@/lib/store-config"
import { getStorePolicyIds } from "@/features/store-policies/get-store-policy-ids"

import type { CatalogProduct } from "./catalog-product"
import { displayProductTitle } from "./display-product-title"
import { getProductVariantListings } from "./get-product-variant-listings"

export function createProductStructuredData(product: CatalogProduct, siteUrl: URL) {
  const title = displayProductTitle(product.title)
  const productUrl = new URL(`/shop/${encodeURIComponent(product.id)}`, siteUrl).href
  const description = product.description.trim()
  const policyIds = getStorePolicyIds(siteUrl)
  const hasVariant = getProductVariantListings(product, siteUrl).map((variant) => ({
    "@type": "Product" as const,
    "@id": `${productUrl}#variant-${variant.id}`,
    name: `${title} – ${variant.color} / ${variant.size}`,
    ...(description ? { description } : {}),
    sku: `${product.id}-${variant.id}`,
    color: variant.color,
    size: variant.size,
    image: variant.images,
    url: variant.url,
    offers: {
      "@type": "Offer" as const,
      url: variant.url,
      price: (variant.price / 100).toFixed(2),
      priceCurrency: variant.currency,
      availability: variant.available ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      itemCondition: "https://schema.org/NewCondition",
      hasMerchantReturnPolicy: { "@id": policyIds.merchantReturnPolicy },
      // Keep every offer tied to the same regional rates and delivery estimates.
      shippingDetails: {
        "@type": "OfferShippingDetails" as const,
        hasShippingService: { "@id": policyIds.shippingService },
      },
    },
  }))

  return {
    "@context": "https://schema.org",
    "@graph": [
      ...(title.trim() && product.id.trim() && hasVariant.length
        ? [
            {
              "@type": "ProductGroup" as const,
              "@id": `${productUrl}#product`,
              name: title,
              ...(description ? { description } : {}),
              url: productUrl,
              productGroupID: product.id,
              brand: { "@type": "Brand", name: storeConfig.name },
              variesBy: ["https://schema.org/color", "https://schema.org/size"],
              hasVariant,
            },
          ]
        : []),
      {
        "@type": "BreadcrumbList" as const,
        "@id": `${productUrl}#breadcrumbs`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: new URL("/", siteUrl).href },
          { "@type": "ListItem", position: 2, name: "Shop", item: new URL("/shop", siteUrl).href },
          { "@type": "ListItem", position: 3, name: title, item: productUrl },
        ],
      },
    ],
  }
}
