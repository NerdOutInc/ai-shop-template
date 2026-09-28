import { displayProductTitle } from "./display-product-title"

export function displayProductVariantTitle(title: string, variant: { color: string; size: string }) {
  return `${displayProductTitle(title)} – ${variant.color} / ${variant.size}`
}
