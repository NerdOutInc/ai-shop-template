import "server-only"
import { getPublishingStore } from "./get-publishing-store.server"

/**
 * The storefront's cached display read. Separate from readPublishedProduct so the two correctness
 * requirements are visible at the import: checkout needs the whole gate applied in SQL, while the
 * cached read must carry revealAt out and compare it against a live clock.
 */
export function readRevealableProduct(
  productId: string
): Promise<{ snapshot: Record<string, unknown>; revealAt: string | null; addedToShopAt: string | null } | null> {
  return getPublishingStore().readRevealableProduct(productId)
}
