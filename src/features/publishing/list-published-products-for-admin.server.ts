import "server-only"
import { getPublishingStore } from "./get-publishing-store.server"

/**
 * Every active published product, hidden ones included.
 *
 * Ungated on purpose and named so: the admin has to see a tee that is waiting for its drop, which is
 * exactly the one the storefront must not show. Never use this on a public path — listShownProducts
 * is the gated sibling.
 */
export function listPublishedProducts(): Promise<Record<string, unknown>[]> {
  return getPublishingStore().listProducts()
}
