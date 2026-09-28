import "server-only"

import { getPublishingStore } from "@/features/publishing/get-publishing-store.server"

import type { AdminGarment, ShopCategory } from "./garment-catalog"

export type AdminGarmentSetup =
  | { status: "ready"; categories: ShopCategory[]; garments: AdminGarment[]; productsWithoutBlueprint: number }
  | { status: "unavailable" }

/**
 * Everything the Categories and Garment models pages draw: the categories a garment can be given,
 * and every blueprint the shop has set up or has published products on.
 *
 * Catches like listFeaturedOrder does. Merging a pull request does not apply migrations in this
 * project, so until the garment tables are pushed these pages must say so rather than 500.
 *
 * The SQL lives in the publishing feature's garment store, not here: counting "shown" products
 * compares visibility columns, and only the two Postgres stores in src/features/publishing may.
 */
export async function listAdminGarmentSetup(): Promise<AdminGarmentSetup> {
  try {
    // Inside the try: getPublishingStore() throws when the database is not configured.
    const { garments: store } = getPublishingStore()
    const [categories, { garments, productsWithoutBlueprint }] = await Promise.all([
      store.listCategories(),
      store.listGarments(),
    ])
    return { status: "ready", categories, garments, productsWithoutBlueprint }
  } catch {
    // The error can name the database host; the label is all the log needs.
    console.warn("Garment setup unavailable", { reason: "storage" })
    return { status: "unavailable" }
  }
}
