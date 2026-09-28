import "server-only"

import { env } from "@/lib/env"

import { listStorefrontProductIds } from "./list-storefront-product-ids.server"
import { readStorefrontProduct } from "./read-storefront-product.server"

export async function getSitemapProductIds(): Promise<string[]> {
  if (!env.PRINTIFY_PUBLISHING_ENABLED) throw new Error("Published catalog is not enabled")
  const ids = await listStorefrontProductIds()
  const snapshots = await Promise.all(ids.map((id) => readStorefrontProduct(id)))
  // A product can be hidden between the membership and snapshot reads.
  return ids.filter((_, index) => snapshots[index] !== null)
}
