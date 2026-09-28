import "server-only"
import { getPublishingStore } from "./get-publishing-store.server"

/**
 * The merchant feeds' product set. Named for the gate it applies: leaving a hidden product in the
 * Google or Meta feed is the policy violation the reveal gate exists to prevent, so this must never
 * quietly widen back to every active product.
 */
export function listShownProducts(): Promise<Record<string, unknown>[]> {
  return getPublishingStore().listShownProducts()
}
