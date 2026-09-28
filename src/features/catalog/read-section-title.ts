import type { CatalogDescriptionBlock } from "./catalog-product"

/**
 * The text of a block that titles a description section, or null. A section title is a heading or,
 * as Printify's editor saves it, a paragraph that is entirely bold.
 */
export function readSectionTitle(block: CatalogDescriptionBlock) {
  if (block.type === "list") return null
  const words = block.content.filter((part) => part.text.trim())
  if (!words.length || (block.type === "paragraph" && !words.every((part) => part.bold))) return null
  return block.content
    .map((part) => part.text)
    .join("")
    .replace(/\s+/g, " ")
    .trim()
}
