import type { CatalogProduct } from "./catalog-product"

function imageUrl(src: string, siteUrl: URL) {
  try {
    const url = new URL(src, siteUrl)
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null
  } catch {
    return null
  }
}

export function getProductVariantListings(product: CatalogProduct, siteUrl: URL) {
  const productUrl = new URL(`/shop/${encodeURIComponent(product.id)}`, siteUrl).href
  return product.variants.flatMap((variant) => {
    // Only describe options that the page can preselect unambiguously through its color/size controls.
    if (
      !variant.color?.trim() ||
      !variant.size?.trim() ||
      !product.colors.some((color) => color.name === variant.color) ||
      product.variants.filter((item) => item.color === variant.color && item.size === variant.size).length !== 1 ||
      !Number.isSafeInteger(variant.id) ||
      !Number.isSafeInteger(variant.price) ||
      variant.price < 0 ||
      variant.currency !== "USD"
    ) {
      return []
    }

    // The gallery shares photos across sizes of a color; a different color's default photo is not a fallback.
    const colorVariantIds = new Set(
      product.variants.filter((item) => item.color === variant.color).map((item) => item.id)
    )
    const images = [
      ...new Set(
        product.images
          .filter((image) => image.variantIds.some((id) => colorVariantIds.has(id)))
          .map((image) => imageUrl(image.src, siteUrl))
          .filter((url) => url !== null)
      ),
    ]
    if (!images.length) return []

    const variantUrl = new URL(productUrl)
    variantUrl.searchParams.set("color", variant.color)
    variantUrl.searchParams.set("size", variant.size)
    return [{ ...variant, color: variant.color, size: variant.size, images, url: variantUrl.href }]
  })
}
