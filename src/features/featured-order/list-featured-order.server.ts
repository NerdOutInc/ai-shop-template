import "server-only"

import { displayProductTitle } from "@/features/catalog/display-product-title"
import { normalizeCatalogProduct } from "@/features/catalog/normalize-catalog-product"
import { getPublishingStore } from "@/features/publishing/get-publishing-store.server"

import type { FeaturedOrderProduct } from "./featured-order-product"

type AdminProduct = {
  snapshot: Record<string, unknown>
  hiddenAt: string | null
  revealAt: string | null
  revealedAt: string | null
  addedToShopAt: string | null
}

/**
 * Deliberately ungated: this page owns both lists, and a lineup save must still name every active
 * product, so a hidden one has to be here too.
 */
export async function listFeaturedOrder(): Promise<
  { status: "ready"; products: FeaturedOrderProduct[]; now: number } | { status: "unavailable" }
> {
  try {
    const rows = await getPublishingStore().listAdminProducts()
    // Stamped here rather than in the page: reading a clock during render is impure, and grouping
    // the two lists has to agree with the moment these rows were read.
    return { status: "ready", products: rows.map(toFeaturedOrderProduct), now: Date.now() }
  } catch {
    console.warn("Featured order unavailable", { reason: "storage" })
    return { status: "unavailable" }
  }
}

function toFeaturedOrderProduct({
  snapshot,
  hiddenAt,
  revealAt,
  revealedAt,
  addedToShopAt,
}: AdminProduct): FeaturedOrderProduct {
  const id = String(snapshot.id)
  const visibility = { hiddenAt, revealAt, revealedAt, addedToShopAt }
  try {
    const product = normalizeCatalogProduct(snapshot)
    return { id, title: displayProductTitle(product.title), image: product.image, ...visibility }
  } catch {
    // A save must name every active product, so keep ones the storefront cannot display.
    const title = typeof snapshot.title === "string" && snapshot.title ? displayProductTitle(snapshot.title) : id
    return { id, title, image: null, ...visibility }
  }
}
