import "server-only"

import { getPublishingStore } from "@/features/publishing/get-publishing-store.server"

import type { ProductGarmentStatus } from "./garment-catalog"

/**
 * Which active products sit on a garment that still needs setup, for the Products page's notices.
 *
 * A separate, caught read rather than extra columns on listAdminProducts. The Products page has to
 * keep working while this slice's migration is merged but not yet pushed, and a lineup query that
 * joined a table which does not exist yet would take the whole page down with it.
 *
 * Null means "could not tell", never "all fine". The page then shows no garment notices, and the
 * server still refuses to show or schedule a product whose garment is incomplete.
 */
export async function listProductGarmentStatus(): Promise<ProductGarmentStatus[] | null> {
  try {
    // Inside the try: getPublishingStore() throws when the database is not configured.
    return await getPublishingStore().garments.listProductGarmentStatus()
  } catch {
    console.warn("Product garment status unavailable", { reason: "storage" })
    return null
  }
}
