import "server-only"

import { z } from "zod"

import { productionFingerprintVersion } from "@/lib/printify/production-fingerprint-version"

import { catalogStockSchema, type CatalogStock } from "./catalog-stock-schema"
import { readCatalogObservation } from "./read-catalog-observation.server"

const publicationStockSchema = catalogStockSchema.extend({ observedAt: z.number().finite() })

export async function readCatalogStock(
  snapshots: readonly Record<string, unknown>[] = []
): Promise<CatalogStock["products"] | null> {
  try {
    const observation = await readCatalogObservation("stock")
    if (!observation) {
      console.warn("Stored catalog stock unavailable", { code: "CATALOG_STOCK_MISSING" })
      return null
    }
    // Check age outside the cache so a failed refresh cannot keep stock usable indefinitely.
    const age = Date.now() - observation.observedAt
    if (!Number.isFinite(age) || age < 0 || age >= 2 * 60 * 60_000) {
      console.warn("Stored catalog stock unavailable", { code: "CATALOG_STOCK_STALE" })
      return null
    }
    const stock = catalogStockSchema.parse(observation.payload)
    if (stock.fingerprintVersion !== productionFingerprintVersion) {
      console.warn("Stored catalog stock unavailable", { code: "CATALOG_STOCK_INVALID" })
      return null
    }
    const products = { ...stock.products }
    for (const snapshot of snapshots) {
      if (typeof snapshot.id !== "string") continue
      const parsed = publicationStockSchema.safeParse(snapshot.storefront_stock)
      if (!parsed.success) continue
      const published = parsed.data
      // A revision's live read bridges publication until a newer complete scan replaces it.
      // Never let an older scan or publication extend the other's observation lifetime.
      if (
        published.fingerprintVersion === productionFingerprintVersion &&
        published.observedAt > observation.observedAt &&
        published.observedAt <= Date.now() &&
        Date.now() - published.observedAt < 2 * 60 * 60_000 &&
        Object.hasOwn(published.products, snapshot.id)
      )
        products[snapshot.id] = published.products[snapshot.id]!
    }
    return products
  } catch {
    console.warn("Stored catalog stock unavailable")
    return null
  }
}
