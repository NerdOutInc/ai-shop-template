import "server-only"
import { getPublishingStore } from "./get-publishing-store.server"

export function readPublishedProduct(productId: string): Promise<Record<string, unknown> | null> {
  return getPublishingStore().readProduct(productId)
}
