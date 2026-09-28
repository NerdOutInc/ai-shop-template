import "server-only"

import { z } from "zod"

import { readCatalogObservation } from "@/features/catalog-sync/read-catalog-observation.server"

type PopularityResult = { status: "ready"; counts: Record<string, number> } | { status: "unavailable" }
const countsSchema = z.record(z.string(), z.number().int().nonnegative())

export async function readPopularity(productIds: readonly string[]): Promise<PopularityResult> {
  if (!productIds.length) return { status: "ready", counts: {} }
  try {
    const observation = await readCatalogObservation("popularity")
    if (!observation) {
      console.warn("Stored catalog popularity unavailable", { code: "CATALOG_POPULARITY_MISSING" })
      return { status: "unavailable" }
    }
    const age = Date.now() - observation.observedAt
    if (!Number.isFinite(age) || age < 0 || age >= 24 * 60 * 60_000) {
      console.warn("Stored catalog popularity unavailable", { code: "CATALOG_POPULARITY_STALE" })
      return { status: "unavailable" }
    }
    const counts = countsSchema.parse(observation.payload)
    // Membership can change between complete scans; keep existing rankings while new IDs start at zero.
    return {
      status: "ready",
      counts: Object.fromEntries(productIds.map((id) => [id, Object.hasOwn(counts, id) ? counts[id]! : 0])),
    }
  } catch {
    console.warn("Stored catalog popularity unavailable")
    return { status: "unavailable" }
  }
}
