import "server-only"

import { getCatalog } from "@/features/catalog/get-catalog.server"
import type { ProductWeek } from "@/features/publishing/product-schedule-entry"

import type { DropEmailProduct } from "./drop-email-product"
import { toDropEmailProduct } from "./to-drop-email-product"

/**
 * The drop's products as the home page shows them: the week's roster intersected with the live shop,
 * in shop order.
 *
 * Null means "could not tell", and a partial catalog counts: the email is frozen once, so a tee that
 * failed to load would be missing from it for good. Products nobody can buy right now are left out,
 * because an email is a worse place than the shop to say "currently unavailable".
 */
export async function readDropEmailProducts(week: ProductWeek): Promise<DropEmailProduct[] | null> {
  const catalog = await getCatalog({ productWeek: week })
  if (catalog.status === "unavailable" || catalog.status === "partial") return null
  const roster = new Set(catalog.designOfTheWeekProductIds ?? [])
  return catalog.products
    .filter((product) => roster.has(product.id) && product.availability === "available")
    .map(toDropEmailProduct)
}
