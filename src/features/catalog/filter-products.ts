import type { CatalogProduct } from "./catalog-product"
import { getColorFamily } from "./get-color-family"

export type CatalogSort = "featured" | "newest" | "popular"

export function filterProducts(
  products: CatalogProduct[],
  filters: { colors: string[]; sizes: string[]; categories?: string[]; sort: CatalogSort; leadingIds?: string[] }
) {
  const selectedColors = new Set(filters.colors)
  const colorFamilies = new Map<string, string>()
  function matchesColor(color: string | null) {
    if (!selectedColors.size) return true
    if (color === null) return false
    let family = colorFamilies.get(color)
    if (family === undefined) {
      family = getColorFamily(color).name
      colorFamilies.set(color, family)
    }
    return selectedColors.has(family)
  }

  const filtered = products.filter((product) => {
    const category = product.garment?.categorySlug
    if (filters.categories?.length && (!category || !filters.categories.includes(category))) return false
    if (!filters.colors.length && !filters.sizes.length) return true
    // Color and size must exist together on one purchasable variant, not just somewhere on the product.
    return product.variants.some(
      (variant) =>
        variant.available &&
        matchesColor(variant.color) &&
        (!filters.sizes.length || (variant.size !== null && filters.sizes.includes(variant.size)))
    )
  })
  /**
   * This week's drop leads Featured, and only Featured.
   *
   * Featured is editorial by construction. Newest and Most Popular each make a factual claim: when a
   * tee reached the shop, and what other people bought. A drop revealed on its Monday is already the
   * newest arrival without help, and pinning it would put it above a tee the owner showed on Tuesday.
   * A tee that went live this week has close to no sales, so pinning it under Most Popular would be a
   * lie that overwrites the one ordering a shopper reaches for to find what is actually selling.
   */
  function lead(sorted: CatalogProduct[]) {
    const leading = new Set(filters.leadingIds ?? [])
    if (leading.size === 0) return sorted
    // Partition rather than sort: everything keeps its relative order on both sides.
    return [
      ...sorted.filter((product) => leading.has(product.id)),
      ...sorted.filter((product) => !leading.has(product.id)),
    ]
  }

  // Stable, so tees that arrived together keep their Featured order, and ones with no arrival
  // (sorted as 0) follow everything else in that order too.
  if (filters.sort === "newest")
    return filtered.toSorted(
      (a, b) => (Date.parse(b.addedToShopAt ?? "") || 0) - (Date.parse(a.addedToShopAt ?? "") || 0)
    )
  if (filters.sort === "popular" && products.every((product) => product.salesCount !== null)) {
    return filtered.toSorted((a, b) => (b.salesCount ?? 0) - (a.salesCount ?? 0))
  }
  return lead(filtered)
}
