import { hasRevealArrived } from "@/features/publishing/has-reveal-arrived"

import type { FeaturedOrderProduct } from "./featured-order-product"

/** A reached reveal makes a product visible even while its original hiddenAt remains recorded. */
export function isProductOnTheWall(product: FeaturedOrderProduct, now: number) {
  return (
    product.hiddenAt === null || (product.revealAt !== null && hasRevealArrived({ revealAt: product.revealAt }, now))
  )
}
