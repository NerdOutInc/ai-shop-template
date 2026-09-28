import "server-only"

import type { ProductWeek } from "@/features/publishing/product-schedule-entry"
import { readProductWeek } from "@/features/design-of-the-week/read-product-week.server"
import { storeConfig } from "@/lib/store-config"
import { env } from "@/lib/env"

import type { CatalogResult } from "./catalog-product"
import { isNewProduct } from "./is-new-product"
import { listStorefrontProductIds } from "./list-storefront-product-ids.server"
import { readStorefrontProduct } from "./read-storefront-product.server"
import { readPublishedCatalog } from "./read-published-catalog.server"
import { readPopularity } from "./read-popularity.server"

/** A page can share its weekly read so a boundary cannot put another week's products under its heading. */
export async function getCatalog(
  options: { productWeek?: ProductWeek | null | Promise<ProductWeek | null> } = {}
): Promise<CatalogResult> {
  if (!env.PRINTIFY_PUBLISHING_ENABLED) return { status: "unavailable", products: [], popularityStatus: "unavailable" }
  try {
    const productIds = await listStorefrontProductIds()
    const results = await Promise.allSettled(productIds.map((id) => readStorefrontProduct(id)))
    const snapshots = results.flatMap((result) => (result.status === "fulfilled" && result.value ? [result.value] : []))
    const failed = results.some((result) => result.status === "rejected")
    const [catalog, popularity, productWeek] = await Promise.all([
      readPublishedCatalog(snapshots),
      readPopularity(productIds),
      storeConfig.features.designOfTheWeek
        ? options.productWeek === undefined
          ? readProductWeek()
          : options.productWeek
        : null,
    ])
    const now = Date.now()
    return {
      ...catalog,
      status: failed ? (catalog.products.length ? "partial" : "unavailable") : catalog.status,
      popularityStatus: popularity.status,
      newProductIds: catalog.products.filter((product) => isNewProduct(product, now)).map((product) => product.id),
      ...(productWeek
        ? {
            designOfTheWeekProductIds: snapshots.flatMap((snapshot) =>
              typeof snapshot.id === "string" && productWeek.productIds.includes(snapshot.id) ? [snapshot.id] : []
            ),
          }
        : {}),
      products: catalog.products.map((product) => ({
        ...product,
        salesCount: popularity.status === "ready" ? (popularity.counts[product.id] ?? 0) : null,
      })),
    }
  } catch {
    console.warn("Published catalog unavailable", { reason: "storage" })
    return { status: "unavailable", products: [], popularityStatus: "unavailable" }
  }
}
