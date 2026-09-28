import type { CatalogProduct } from "./catalog-product"
import { isGarmentSectionTitle } from "./is-garment-section-title"
import { readSectionTitle } from "./read-section-title"

/**
 * The prose and lists under a description's garment heading ("The tee", "The crop top", …),
 * without the heading itself or any later section. Empty when no garment section can be found.
 */
export function getGarmentDescriptionBlocks({
  title,
  descriptionBlocks = [],
}: Pick<CatalogProduct, "title" | "descriptionBlocks">) {
  const start = descriptionBlocks.findIndex((block) => {
    const text = readSectionTitle(block)
    return text !== null && isGarmentSectionTitle(text, title)
  })
  if (start === -1) return []
  const end = descriptionBlocks.findIndex((block, index) => index > start && readSectionTitle(block) !== null)
  return descriptionBlocks.slice(start + 1, end === -1 ? undefined : end)
}
