import type { CatalogProduct } from "@/features/catalog/catalog-product"
import { displayProductTitle } from "@/features/catalog/display-product-title"

import type { DropEmailProduct } from "./drop-email-product"

export function toDropEmailProduct(product: CatalogProduct): DropEmailProduct {
  const image = product.image && product.image.src.startsWith("https://") ? product.image : null
  return {
    id: product.id,
    title: displayProductTitle(product.title),
    image: image && { src: image.src, alt: image.alt },
    price: product.price && { min: product.price.min, max: product.price.max },
  }
}
