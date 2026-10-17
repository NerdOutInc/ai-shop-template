import type { MerchantProduct } from "./merchant-product"

export function feedDescription(product: MerchantProduct["product"]) {
  const guide = product.sizeGuide
  if (product.description !== "" || !guide?.sizes.length || !guide.measurements.length) return product.description
  // Table-only provider copy has no storefront prose. Keep its facts in the feed without changing the page's intro.
  return [
    product.title,
    "Size guide",
    ...guide.measurements.map(
      (row) => `${row.label}: ${row.values.map((value, index) => `${guide.sizes[index]}: ${value}`).join("; ")}`
    ),
  ].join("\n")
}
