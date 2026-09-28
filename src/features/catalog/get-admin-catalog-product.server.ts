import "server-only"

import { getAdminActor } from "@/features/admin/get-admin-actor.server"
import { listPublishedProducts } from "@/features/publishing/list-published-products-for-admin.server"
import { env } from "@/lib/env"

import type { CatalogProductResult } from "./catalog-product"
import { readPublishedCatalog } from "./read-published-catalog.server"

/** An uncached, authenticated sibling of the public reader, including hidden published products. */
export async function getAdminCatalogProduct(productId: string): Promise<CatalogProductResult> {
  if (!(await getAdminActor())) return { status: "missing" }
  if (!env.PRINTIFY_PUBLISHING_ENABLED) return { status: "missing" }
  try {
    const snapshots = await listPublishedProducts()
    const snapshot = snapshots.find((candidate) => candidate.id === productId)
    if (!snapshot || String(snapshot.shop_id) !== env.PRINTIFY_SHOP_ID) return { status: "missing" }
    const catalog = await readPublishedCatalog([snapshot])
    const product = catalog.products[0]
    // A private preview is of a product the shop is not showing, and "new" means new in the shop.
    return product ? { status: "ready", product, isNew: false } : { status: "unavailable" }
  } catch {
    console.warn("Admin product preview unavailable", { reason: "storage" })
    return { status: "unavailable" }
  }
}
