import type { CatalogProduct } from "./catalog-product"
import { catalogProductSchema } from "./catalog-product-schema"
import { displayProductTitle } from "./display-product-title"
import { readProductDescription } from "./read-product-description"

export function normalizeCatalogProduct(raw: unknown): CatalogProduct {
  const product = catalogProductSchema.parse(raw)
  const enabled = product.variants.filter((variant) => variant.is_enabled)
  const available = enabled.filter((variant) => variant.is_available)
  const enabledIds = new Set(enabled.map((variant) => variant.id))
  const availableOptions = new Set(available.flatMap((variant) => variant.options))
  const images = product.images.filter((image) => {
    if (!image.variant_ids.some((id) => enabledIds.has(id))) return false
    try {
      const url = new URL(image.src)
      return url.protocol === "https:" && !url.username && !url.password
    } catch {
      return false
    }
  })
  const image = images.find((image) => image.is_default) ?? images[0]
  const orderedImages = image ? [image, ...images.filter((item) => item !== image)] : images
  const prices = available.map((variant) => variant.price)

  const variants = enabled.map((variant) => {
    const options = product.options.flatMap((option) => {
      const value = option.values.find((value) => variant.options.includes(value.id))
      return value ? [{ name: option.name, value: value.title }] : []
    })
    const colorOption = product.options.find((option) => option.type === "color" || /^colou?rs?$/i.test(option.name))
    const sizeOption = product.options.find((option) => option.type === "size" || /^sizes?$/i.test(option.name))
    return {
      id: variant.id,
      title: variant.title ?? options.map((option) => option.value).join(" / "),
      price: variant.price,
      currency: "USD" as const,
      available: variant.is_available,
      color: colorOption?.values.find((value) => variant.options.includes(value.id))?.title ?? null,
      size: sizeOption?.values.find((value) => variant.options.includes(value.id))?.title ?? null,
      options,
    }
  })
  const colorOption = product.options.find((option) => option.type === "color" || /^colou?rs?$/i.test(option.name))
  const enabledOptions = new Set(enabled.flatMap((variant) => variant.options))
  const addedToShopAt = product.storefront_added_to_shop_at ? new Date(product.storefront_added_to_shop_at) : null
  const colors =
    colorOption?.values
      .filter((value) => enabledOptions.has(value.id))
      .map((value) => ({
        name: value.title,
        hex: value.colors?.find((color) => /^#[\da-f]{6}$/i.test(color)) ?? null,
      })) ?? []
  // A general photo can cover multiple colors. Only assign a background when the pictured color is unambiguous.
  const imageColors = new Set(
    variants.filter((variant) => image?.variant_ids.includes(variant.id)).map((variant) => variant.color)
  )
  const backgroundColor =
    imageColors.size === 1 ? (colors.find((color) => imageColors.has(color.name))?.hex ?? null) : null
  const artworkSrc = product.storefront_artwork_enabled ? product.storefront_artwork?.src : undefined

  return {
    ...readProductDescription(product.description),
    addedToShopAt: addedToShopAt && Number.isFinite(addedToShopAt.getTime()) ? addedToShopAt.toISOString() : null,
    salesCount: null,
    variants,
    colors,
    artwork: artworkSrc
      ? { src: artworkSrc, alt: `${displayProductTitle(product.title)} artwork`, backgroundColor }
      : null,
    defaultColor:
      variants.find((variant) => image?.variant_ids.includes(variant.id) && variant.color !== null)?.color ??
      colors[0]?.name ??
      null,
    images: orderedImages.map((image) => ({
      src: image.src,
      alt: product.title,
      variantIds: image.variant_ids.filter((id) => enabledIds.has(id)),
      ...(image.view_key ? { viewKey: image.view_key } : {}),
    })),
    id: product.id,
    title: product.title,
    image: image
      ? { src: image.src, alt: product.title, ...(image.view_key ? { viewKey: image.view_key } : {}) }
      : null,
    price: prices.length ? { currency: "USD", min: Math.min(...prices), max: Math.max(...prices) } : null,
    options: product.options
      .map((option) => ({
        name: option.name,
        values: [
          ...new Set(option.values.filter((value) => availableOptions.has(value.id)).map((value) => value.title)),
        ],
      }))
      .filter((option) => option.values.length > 0),
    availability: available.length ? "available" : "unavailable",
  }
}
