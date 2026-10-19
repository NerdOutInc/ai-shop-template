import { displayColorName } from "@/lib/display-color-name"

import { displayProductTitle } from "./display-product-title"

export function displayProductVariantTitle(title: string, variant: { color: string; size: string }) {
  return `${displayProductTitle(title)} – ${displayColorName(variant.color)} / ${variant.size}`
}
