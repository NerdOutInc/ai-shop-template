import { displayColorName } from "@/lib/display-color-name"

import type { CartItem } from "./cart-item"

export function displayCartItemTitle({ title, variantTitle }: Pick<CartItem, "title" | "variantTitle">) {
  const suffix = ` – ${variantTitle}`
  // Older Meta carts put the provider shade in the title as well as the variant label.
  return title.endsWith(suffix) ? `${title.slice(0, -suffix.length)} – ${displayColorName(variantTitle)}` : title
}
