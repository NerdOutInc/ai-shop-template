import { JsonLdScript } from "@/components/json-ld-script"
import type { CatalogProduct } from "@/features/catalog/catalog-product"

/** A summary-page ItemList: position and url only, so each product page keeps its own full Product graph. */
export function ShopStructuredData({ products, siteUrl }: { products: readonly CatalogProduct[]; siteUrl: URL }) {
  if (!products.length) return null
  return (
    <JsonLdScript
      data={{
        "@context": "https://schema.org",
        "@type": "ItemList",
        "@id": new URL("/shop#products", siteUrl).href,
        numberOfItems: products.length,
        itemListElement: products.map((product, index) => ({
          "@type": "ListItem",
          position: index + 1,
          url: new URL(`/shop/${encodeURIComponent(product.id)}`, siteUrl).href,
        })),
      }}
    />
  )
}
