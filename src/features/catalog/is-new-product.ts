const twoWeeks = 14 * 24 * 60 * 60 * 1000

/**
 * New means it entered the shop less than 14 full days ago. The owner's rule, and the only place it
 * is written down: the shop cards, the product page and the admin lineup all ask this.
 *
 * A stamp slightly ahead of `now` still counts as new. The database clock stamps Show and the app
 * server's clock reads it, and a few milliseconds between them must not hide a badge on the tee the
 * owner just put up.
 */
export function isNewProduct(product: { addedToShopAt: string | null }, now: number): boolean {
  if (product.addedToShopAt === null) return false
  const addedAt = Date.parse(product.addedToShopAt)
  return Number.isFinite(addedAt) && now - addedAt < twoWeeks
}
