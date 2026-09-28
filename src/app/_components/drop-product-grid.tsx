import type { CatalogProduct } from "@/features/catalog/catalog-product"
import { ProductCard } from "@/features/catalog/product-card"

/** The shop's own card grid, reused so a tee looks the same wherever a shopper meets it. */
export function DropProductGrid({
  products,
  label,
  newProductIds = [],
}: {
  products: CatalogProduct[]
  label: string
  /** The catalog's newProductIds. Being in this week's drop does not make a tee new by itself. */
  newProductIds?: string[]
}) {
  return (
    <ul
      role="list"
      aria-label={label}
      className="grid grid-cols-1 gap-x-4 gap-y-10 sm:grid-cols-2 sm:gap-x-6 lg:grid-cols-3 lg:gap-y-12"
    >
      {products.map((product) => (
        <li key={product.id} className="min-w-0">
          <ProductCard
            product={product}
            isNew={newProductIds.includes(product.id)}
            // Each grid sits under an h3 within the home page's weekly section.
            headingLevel={4}
          />
        </li>
      ))}
    </ul>
  )
}
