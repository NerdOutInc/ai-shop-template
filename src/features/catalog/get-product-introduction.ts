import type { CatalogProduct } from "./catalog-product"
import { displayProductTitle } from "./display-product-title"
import { isGarmentDetailHeading } from "./is-garment-detail-heading"
import { isGarmentSectionTitle } from "./is-garment-section-title"
import { readSectionTitle } from "./read-section-title"

const designSection = /^(?:the design|about the design|design details)[\s:]*$/i
const garmentBoilerplate =
  /^(?:printed on (?:the )?next level|(?:the )?next level 6210\b|this (?:classic unisex|unisex|premium fitted)\b)/i

export function getProductIntroduction(product: Pick<CatalogProduct, "title" | "description" | "descriptionBlocks">) {
  const title = displayProductTitle(product.title).trim().toLowerCase()
  const paragraphs = product.descriptionBlocks?.length
    ? product.descriptionBlocks.flatMap((block) => {
        if (block.type === "list") return []
        const sectionTitle = readSectionTitle(block)
        return [
          {
            text: block.content.map((part) => part.text).join(""),
            heading: block.type === "heading",
            garment: sectionTitle !== null && isGarmentSectionTitle(sectionTitle, product.title),
          },
        ]
      })
    : product.description.split(/\n+/).map((text) => ({ text, heading: false, garment: false }))

  for (const paragraph of paragraphs) {
    const text = paragraph.text.replace(/\s+/g, " ").trim()
    // The first garment or care section ends the design prose, whatever the garment is called. Plain
    // text has no bold to mark a title, so only the named sections end it there.
    if (paragraph.garment || isGarmentDetailHeading(text)) break
    if (!text || paragraph.heading || text.toLowerCase() === title || designSection.test(text)) continue
    if (garmentBoilerplate.test(text)) break
    return text
  }

  return "An original design, made to order. Find your fit and make it yours."
}
