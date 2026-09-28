import "server-only"

import { z } from "zod"

import { parsePrintifyProduct } from "@/lib/printify/parse-printify-product"
import { productionFingerprintVersion } from "@/lib/printify/production-fingerprint-version"

import type { CatalogStock } from "./catalog-stock-schema"

const pageSchema = z.object({
  current_page: z.number().int().positive(),
  last_page: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  data: z.array(z.object({ id: z.string().min(1), shop_id: z.number().int().positive() }).passthrough()),
})

export async function fetchCatalogStock(
  config: { apiToken: string; shopId: string },
  productIds: readonly string[]
): Promise<CatalogStock> {
  const products: CatalogStock["products"] = Object.fromEntries(productIds.map((id) => [id, []]))
  if (!productIds.length) return { fingerprintVersion: productionFingerprintVersion, products }
  const selected = new Set(productIds)
  const seen = new Set<string>()
  const deadline = AbortSignal.timeout(45_000)
  let expectedTotal: number | undefined
  let expectedLastPage: number | undefined
  try {
    for (let page = 1; page <= 20; page++) {
      const response = await fetch(
        `https://api.printify.com/v1/shops/${config.shopId}/products.json?limit=50&page=${page}`,
        {
          headers: {
            Authorization: `Bearer ${config.apiToken}`,
            "User-Agent": "Clothing-Store/0.1",
            Accept: "application/json",
          },
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.any([deadline, AbortSignal.timeout(15_000)]),
        }
      )
      if (!response.ok) throw new Error("Product scan failed")
      const data = pageSchema.parse(await response.json())
      if (
        data.current_page !== page ||
        data.data.length > 50 ||
        (expectedTotal !== undefined && expectedTotal !== data.total) ||
        (expectedLastPage !== undefined && expectedLastPage !== data.last_page)
      )
        throw new Error("Product scan changed")
      expectedTotal = data.total
      expectedLastPage = data.last_page
      for (const raw of data.data) {
        if (String(raw.shop_id) !== config.shopId || seen.has(raw.id)) throw new Error("Invalid product page")
        seen.add(raw.id)
        if (!selected.has(raw.id)) continue
        const product = parsePrintifyProduct(raw, { productId: raw.id, shopId: config.shopId })
        if (!product) {
          console.warn("Catalog product stock unavailable", {
            code: "CATALOG_PRODUCT_INVALID",
            ...(/^[a-zA-Z0-9_-]{1,128}$/.test(raw.id) ? { productId: raw.id } : {}),
          })
          continue
        }
        products[raw.id] = product.variants.map(({ id, enabled, inStock, fingerprint }) => ({
          id,
          enabled,
          inStock,
          fingerprint,
        }))
      }
      if (page >= data.last_page) {
        if (seen.size !== data.total) throw new Error("Incomplete product scan")
        return { fingerprintVersion: productionFingerprintVersion, products }
      }
      if (!data.data.length) throw new Error("Incomplete product scan")
    }
    throw new Error("Product scan exceeds limit")
  } catch {
    // Keep provider bodies, draft production data, and credentials out of logs and job responses.
    throw new Error("CATALOG_STOCK_REFRESH_FAILED")
  }
}
