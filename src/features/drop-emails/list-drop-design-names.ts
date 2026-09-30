/**
 * Each design named once, in roster order.
 *
 * Titles are "Design - Garment" ("Abstract Lines - Festival Crop Top"), and a tee and a crop top of one
 * design are one drop. Only a spaced dash separates them: garments carry their own hyphens
 * ("Premium T-Shirt", "Mid-Weight Hoodie").
 */
export function listDropDesignNames(titles: readonly string[]) {
  const names = titles.map((title) => {
    const garment = [...title.matchAll(/\s+[—–-]\s+/g)].at(-1)
    return (garment ? title.slice(0, garment.index) : title).trim()
  })
  return [...new Set(names)].filter(Boolean)
}
