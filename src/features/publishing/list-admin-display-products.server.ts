import "server-only"
import { getPublishingStore } from "./get-publishing-store.server"

/** Private display only, including hidden products. Callers establish admin access. */
export function listAdminDisplayProducts(): Promise<Record<string, unknown>[]> {
  return getPublishingStore().listAdminDisplayProducts()
}
