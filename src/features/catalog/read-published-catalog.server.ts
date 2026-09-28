import "server-only"

import { z } from "zod"

import { readCatalogStock } from "@/features/catalog-sync/read-catalog-stock.server"
import { listGarmentDisplayProfiles } from "@/features/garment-catalog/list-garment-display-profiles.server"
import { isPublishedVariantAvailable } from "@/lib/printify/is-published-variant-available"
import { parsePrintifyProduct } from "@/lib/printify/parse-printify-product"

import type { CatalogResult } from "./catalog-product"
import { catalogProductSchema } from "./catalog-product-schema"
import { normalizeCatalogProduct } from "./normalize-catalog-product"

const snapshotSchema = z
  .object({
    id: z.string().min(1),
    shop_id: z.number().int().positive(),
    variants: z.array(
      z
        .object({
          id: z.number().int(),
          storefront_production_fingerprint: z
            .string()
            .regex(/^v2:[a-f0-9]{64}$/)
            .optional(),
        })
        .passthrough()
    ),
  })
  .passthrough()

export async function readPublishedCatalog(snapshots: readonly Record<string, unknown>[]): Promise<CatalogResult> {
  if (!snapshots.length) return { status: "empty", products: [] }
  const [observations, garments] = await Promise.all([readCatalogStock(snapshots), listGarmentDisplayProfiles()])
  const results = await Promise.all(
    snapshots.map(async (raw) => {
      try {
        const snapshot = snapshotSchema.parse(raw)
        const display = catalogProductSchema.parse(snapshot)
        normalizeCatalogProduct(display)
        const production =
          "print_areas" in raw
            ? parsePrintifyProduct(raw, { productId: snapshot.id, shopId: String(snapshot.shop_id) })
            : null
        if ("print_areas" in raw && !production) throw new Error("Invalid published production settings")
        const fingerprints = new Map(
          production
            ? production.variants.map((variant) => [variant.id, variant.fingerprint] as const)
            : snapshot.variants.map((variant) => [variant.id, variant.storefront_production_fingerprint] as const)
        )
        const stock = new Map((observations?.[snapshot.id] ?? []).map((variant) => [variant.id, variant]))
        let missingProductionVariantCount = 0
        let fingerprintMismatchVariantCount = 0
        for (const variant of display.variants) {
          if (!variant.is_enabled || variant.price <= 0) continue
          const fingerprint = fingerprints.get(variant.id)
          const current = stock.get(variant.id)
          if (!fingerprint) missingProductionVariantCount++
          else if (current?.enabled && current.inStock && current.fingerprint !== fingerprint) {
            fingerprintMismatchVariantCount++
          }
        }
        if (missingProductionVariantCount) throw new Error("Missing published production fingerprints")
        if (fingerprintMismatchVariantCount) {
          console.warn("Published product purchase availability paused", {
            code: "PUBLISHED_PRODUCTION_UNAVAILABLE",
            ...(/^[a-zA-Z0-9_-]{1,128}$/.test(snapshot.id) ? { productId: snapshot.id } : {}),
            missingProductionVariantCount,
            fingerprintMismatchVariantCount,
          })
        }
        const product = normalizeCatalogProduct({
          ...display,
          variants: display.variants.map((variant) => ({
            ...variant,
            is_available: isPublishedVariantAvailable(
              { enabled: variant.is_enabled, unitAmount: variant.price, fingerprint: fingerprints.get(variant.id) },
              stock.get(variant.id)
            ),
          })),
        })
        return { ...product, garment: display.blueprint_id ? (garments?.get(display.blueprint_id) ?? null) : null }
      } catch {
        console.warn("Published product unavailable", { reason: "invalid-snapshot" })
        return null
      }
    })
  )
  const products = results.filter((product) => product !== null)
  return {
    status: products.length === 0 ? "unavailable" : products.length === snapshots.length ? "ready" : "partial",
    products,
  }
}
