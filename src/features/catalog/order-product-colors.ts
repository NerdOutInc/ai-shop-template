import type { CatalogProduct } from "./catalog-product"

export function orderProductColors(product: Pick<CatalogProduct, "colors" | "defaultColor">) {
  return product.colors.toSorted(
    (first, second) => Number(second.name === product.defaultColor) - Number(first.name === product.defaultColor)
  )
}
