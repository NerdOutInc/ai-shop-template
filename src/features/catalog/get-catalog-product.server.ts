import "server-only"

import { cache } from "react"

import { env } from "@/lib/env"

import type { CatalogProductResult } from "./catalog-product"
import { isNewProduct } from "./is-new-product"
import { readStorefrontProduct } from "./read-storefront-product.server"
import { readPublishedCatalog } from "./read-published-catalog.server"

export const getCatalogProduct = cache(async (productId: string): Promise<CatalogProductResult> => {
  if (!env.PRINTIFY_PUBLISHING_ENABLED) return { status: "unavailable" }
  try {
    const snapshot = await readStorefrontProduct(productId)
    if (!snapshot) return { status: "missing" }
    const catalog = await readPublishedCatalog([snapshot])
    const product = catalog.products[0]
    return product ? { status: "ready", product, isNew: isNewProduct(product, Date.now()) } : { status: "unavailable" }
  } catch {
    console.warn("Published product unavailable", { productId, reason: "storage" })
    return { status: "unavailable" }
  }
})
