import "server-only"

import { createHash } from "node:crypto"

import { displayProductTitle } from "@/features/catalog/display-product-title"
import { displayProductVariantTitle } from "@/features/catalog/display-product-variant-title"
import { getCatalogProduct } from "@/features/catalog/get-catalog-product.server"
import { getProductVariantListings } from "@/features/catalog/get-product-variant-listings"
import { getSiteUrl } from "@/lib/get-site-url"

import type { CartItem } from "./cart-item"
import { parseMetaCart, type MetaCartError, type MetaCartSearchParams } from "./parse-meta-cart"
import { readCartState } from "./read-cart-state"

export type MetaCartResult =
  | { status: "ready"; items: CartItem[]; importKey: string }
  | {
      status: "error"
      reason: MetaCartError | "lookup"
      unavailableItem?: { title: string; variantTitle: string | null; href: string }
    }

export async function resolveMetaCart(params: MetaCartSearchParams): Promise<MetaCartResult> {
  const parsed = parseMetaCart(params)
  if (parsed.status === "error") return parsed
  try {
    const productIds = [...new Set(parsed.selection.map((item) => item.productId))]
    const results = await Promise.all(productIds.map((id) => getCatalogProduct(id)))
    const products = new Map(productIds.map((id, index) => [id, results[index]!]))
    const siteUrl = getSiteUrl()
    const items: CartItem[] = []
    for (const selection of parsed.selection) {
      const result = products.get(selection.productId)!
      if (result.status === "missing") return { status: "error", reason: "unavailable" }
      if (result.status !== "ready" || result.product.id !== selection.productId)
        return { status: "error", reason: "lookup" }
      const publicVariant = result.product.variants.find((item) => item.id === selection.variantId)
      const unavailable: MetaCartResult = {
        status: "error",
        reason: "unavailable",
        unavailableItem: {
          title: displayProductTitle(result.product.title),
          variantTitle:
            publicVariant?.color && publicVariant.size ? `${publicVariant.color} / ${publicVariant.size}` : null,
          href: `/shop/${encodeURIComponent(result.product.id)}`,
        },
      }
      const variant = getProductVariantListings(result.product, siteUrl).find((item) => item.id === selection.variantId)
      if (!variant?.available) return unavailable
      const item: CartItem = {
        ...selection,
        title: displayProductVariantTitle(result.product.title, variant),
        variantTitle: `${variant.color} / ${variant.size}`,
        image: variant.images[0],
        unitAmount: variant.price,
      }
      // Validate each line before returning any selection so recovery can name an unlistable item.
      const validated = readCartState(
        JSON.stringify({ version: 1, checkouts: {}, entries: [{ ...item, entryId: "0" }] })
      )
      if (validated.entries.length !== 1) return unavailable
      items.push(item)
    }
    return {
      status: "ready",
      items,
      importKey: createHash("sha256").update(JSON.stringify(parsed.selection)).digest("hex").slice(0, 32),
    }
  } catch {
    // Provider and database errors can contain secrets; show a fixed recovery message.
    return { status: "error", reason: "lookup" }
  }
}
