import type { CatalogProduct } from "./catalog-product"
import { getColorFamily } from "./get-color-family"
import { orderProductColors } from "./order-product-colors"

/**
 * The color a shop card should show once the color filter is on: the product's first color, in
 * swatch order, whose family is selected and that is purchasable in any selected size. Null when
 * the color filter is off, so the card keeps its own default color and cover photo.
 */
export function getFilteredColor(
  product: Pick<CatalogProduct, "colors" | "defaultColor" | "variants">,
  filters: { colors: string[]; sizes: string[] }
) {
  if (filters.colors.length === 0) return null
  const families = new Set(filters.colors)
  return (
    orderProductColors(product).find(
      (color) =>
        families.has(getColorFamily(color.name).name) &&
        product.variants.some(
          (variant) =>
            variant.available &&
            variant.color === color.name &&
            (filters.sizes.length === 0 || (variant.size !== null && filters.sizes.includes(variant.size)))
        )
    )?.name ?? null
  )
}
