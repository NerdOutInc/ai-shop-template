import { displayProductTitle } from "./display-product-title"

// The page already shows the design prose above the fold and its own care and size sections.
const otherSection =
  /^(?:the design|about the design|design details|care(?: instructions)?|size guide|sizing|shipping(?: (?:&|and) care)?)[\s:]*$/i

// A heading may repeat either the saved "Title — Your Store | Model" or its display form.
function comparableTitle(text: string) {
  return displayProductTitle(text).replace(/\s+/g, " ").trim().toLowerCase()
}

/**
 * Whether a section title names the garment ("The tee", "The crop top", …). Garment headings follow
 * the owner's category names, so any title that is not the product's own or another known section counts.
 */
export function isGarmentSectionTitle(text: string, productTitle: string) {
  return comparableTitle(text) !== comparableTitle(productTitle) && !otherSection.test(text)
}
