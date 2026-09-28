import "server-only"

import { z } from "zod"

import { productionFingerprintVersion } from "@/lib/printify/production-fingerprint-version"

import { catalogStockSchema } from "./catalog-stock-schema"
import { getCatalogSyncStore } from "./get-catalog-sync-store.server"

const countsSchema = z.record(z.string(), z.number().int().nonnegative())

export async function readCatalogRefreshHealth(): Promise<string[]> {
  try {
    // Health must inspect durable timestamps, not a possibly stale Next data cache.
    const store = getCatalogSyncStore()
    const [stock, popularity] = await Promise.all([store.read("stock"), store.read("popularity")])
    const issues: string[] = []
    for (const [kind, observation, warningMinutes] of [
      ["STOCK", stock, 65],
      ["POPULARITY", popularity, 13 * 60],
    ] as const) {
      const age = observation ? Date.now() - observation.observed_at.getTime() : NaN
      if (!Number.isFinite(age) || age < 0 || age >= warningMinutes * 60_000) issues.push(`CATALOG_${kind}_STALE`)
    }
    if (stock) {
      const parsed = catalogStockSchema.safeParse(stock.payload)
      if (!parsed.success || parsed.data.fingerprintVersion !== productionFingerprintVersion)
        issues.push("CATALOG_STOCK_INVALID")
    }
    if (popularity && !countsSchema.safeParse(popularity.payload).success) issues.push("CATALOG_POPULARITY_INVALID")
    return issues
  } catch {
    return ["CATALOG_REFRESH_UNAVAILABLE"]
  }
}
