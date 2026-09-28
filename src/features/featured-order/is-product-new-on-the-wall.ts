import { isNewProduct } from "@/features/catalog/is-new-product"
import { readAddedToShopAt } from "@/features/publishing/read-added-to-shop-at"

import type { FeaturedOrderProduct } from "./featured-order-product"
import { isProductOnTheWall } from "./is-product-on-the-wall"

/**
 * The shop's New badge, asked of an admin row. New means new in the shop, so a hidden product never
 * carries it, whatever its last arrival was: the badge tells the owner what shoppers see.
 */
export function isProductNewOnTheWall(product: FeaturedOrderProduct, now: number) {
  return isProductOnTheWall(product, now) && isNewProduct({ addedToShopAt: readAddedToShopAt(product) }, now)
}
