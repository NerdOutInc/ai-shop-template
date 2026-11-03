import "server-only"

import { listGarmentDisplayProfiles } from "@/features/garment-catalog/list-garment-display-profiles.server"
import { getMerchantProducts } from "@/features/merchant-feed/get-merchant-products.server"
import { getSiteUrl } from "@/lib/get-site-url"

import { createAgentCatalog } from "./create-agent-catalog"

/** JSON discovery and llms.txt share the same stock-checked, listable product set. */
export async function getAgentCatalog() {
  const [products, garments] = await Promise.all([getMerchantProducts(), listGarmentDisplayProfiles()])
  return createAgentCatalog(
    products.map(({ product, blueprintId }) => ({
      product,
      category: garments?.get(blueprintId)?.categoryName?.trim() || null,
    })),
    getSiteUrl()
  )
}
