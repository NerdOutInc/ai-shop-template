import "server-only"

import { normalizeCatalogProduct } from "@/features/catalog/normalize-catalog-product"
import { displayProductTitle } from "@/features/catalog/display-product-title"
import { readStorefrontProduct } from "@/features/catalog/read-storefront-product.server"

export type WeeklyHeroProduct = {
  id: string
  title: string
  color: string | null
  href: string
  image: { src: string; alt: string } | null
}

/** Use published display data only; neither private artwork nor draft provider photos belong here. */
export async function readWeeklyHeroProducts(
  links: { productId: string; color?: string }[]
): Promise<WeeklyHeroProduct[]> {
  const results = await Promise.allSettled(
    links.map(async (link) => {
      const snapshot = await readStorefrontProduct(link.productId)
      if (!snapshot) return null
      const product = normalizeCatalogProduct(snapshot)
      const title = displayProductTitle(product.title)
      const color = link.color || product.defaultColor || null
      const ids = new Set(product.variants.filter((v) => v.color === color).map((v) => v.id))
      const images = product.images.filter((image) => image.variantIds.some((id) => ids.has(id)))
      const image = images.find((image) => image.viewKey === "front") ?? images[0]
      return {
        id: product.id,
        title,
        color,
        href: `/shop/${encodeURIComponent(product.id)}${color ? `?color=${encodeURIComponent(color)}` : ""}`,
        image: image ? { src: image.src, alt: `${title}${color ? ` in ${color}` : ""}` } : null,
      }
    })
  )
  return results.flatMap((result) => (result.status === "fulfilled" && result.value ? [result.value] : []))
}
