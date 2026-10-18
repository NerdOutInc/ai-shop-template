import "server-only"
import { getPublishingStore } from "./get-publishing-store.server"

/** Private display only, including hidden products. Callers establish admin access. */
export function readAdminDisplayProduct(productId: string) {
  return getPublishingStore().readAdminDisplayProduct(productId)
}
