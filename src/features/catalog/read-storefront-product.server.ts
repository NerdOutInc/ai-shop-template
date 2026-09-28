import "server-only"

import { createHash } from "node:crypto"

import { unstable_cache } from "next/cache"

import { hasRevealArrived } from "@/features/publishing/has-reveal-arrived"
import { readAddedToShopAt } from "@/features/publishing/read-added-to-shop-at"
import { readRevealableProduct } from "@/features/publishing/read-revealable-product.server"
import { env } from "@/lib/env"
import { parsePrintifyProduct } from "@/lib/printify/parse-printify-product"
import { productionFingerprintVersion } from "@/lib/printify/production-fingerprint-version"

import { catalogProductSchema } from "./catalog-product-schema"
import { normalizeCatalogProduct } from "./normalize-catalog-product"

export async function readStorefrontProduct(productId: string): Promise<Record<string, unknown> | null> {
  const { DATABASE_URL: databaseUrl, PRINTIFY_SHOP_ID: shopId } = env
  if (!databaseUrl || !shopId) throw new Error("Published catalog is not configured")
  const read = unstable_cache(
    async (id: string) => {
      try {
        const revealable = await readRevealableProduct(id)
        if (!revealable) return null
        const { snapshot: raw, revealAt, addedToShopAt } = revealable
        const snapshot = catalogProductSchema.parse(raw)
        if (snapshot.id !== id || String(snapshot.shop_id) !== shopId) throw new Error("Published product mismatch")
        const production = parsePrintifyProduct(raw, { productId: id, shopId })
        if (!production) throw new Error("Invalid published production settings")
        const fingerprints = new Map(production.variants.map((variant) => [variant.id, variant.fingerprint]))
        const product = normalizeCatalogProduct(snapshot)
        // Keep display-only projections small. Checkout reads the full snapshot directly from storage.
        return {
          ...snapshot,
          storefront_stock: raw.storefront_stock,
          // Carried through the cache so the reveal can be judged against a live clock outside it.
          storefront_reveal_at: revealAt,
          // Clock-free, so safe to settle inside the cache: this projection only leaves
          // readStorefrontProduct once its reveal has arrived, and then the reveal is the arrival.
          storefront_added_to_shop_at: readAddedToShopAt({ addedToShopAt, revealAt }),
          variants: snapshot.variants
            .filter((variant) => variant.is_enabled)
            .map((variant) => ({
              ...variant,
              // Keep eligibility tied to this display revision without exposing production settings.
              ...(fingerprints.has(variant.id)
                ? { storefront_production_fingerprint: fingerprints.get(variant.id) }
                : {}),
            })),
          images: product.images.map((image, index) => ({
            src: image.src,
            variant_ids: image.variantIds,
            is_default: index === 0,
            ...(image.viewKey ? { view_key: image.viewKey } : {}),
          })),
        }
      } catch {
        // Cache refresh errors are logged by Next; never retain SQL errors or connection credentials.
        throw new Error("Published product unavailable")
      }
    },
    [
      "published-catalog-product-v1",
      productionFingerprintVersion,
      shopId,
      createHash("sha256").update(databaseUrl).digest("hex"),
    ],
    { revalidate: 300, tags: ["printify-published-catalog"] }
  )
  const projection = await read(productId)
  // The clock half, outside the cache: a scheduled reveal writes nothing, so no tag revalidation
  // would ever fire for it. A hidden product must read as absent, never as an error.
  if (!projection) return null
  return hasRevealArrived({ revealAt: projection.storefront_reveal_at }, Date.now()) ? projection : null
}
