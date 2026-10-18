"use client"

import Image from "next/image"
import { useState } from "react"

import type { CatalogProduct } from "./catalog-product"
import { canOptimizeProductImage } from "./can-optimize-product-image"
import { displayProductTitle } from "./display-product-title"
import { NewProductBadge } from "./new-product-badge"
import { orderProductColors } from "./order-product-colors"
import { ProductArtworkImage } from "./product-artwork-image"
import { ProductCardLink } from "./product-card-link"

type ProductCardProps = {
  product: CatalogProduct
  priority?: boolean
  /** From the catalog's newProductIds, so the card never reads a clock while it renders. */
  isNew?: boolean
  /**
   * One level beneath the grid's heading. The shop's `h1` makes 2 the default; nested sections
   * pass 3 or 4 so product titles remain beneath their section in heading navigation.
   */
  headingLevel?: 2 | 3 | 4
}
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

export function ProductCard({ product, priority = false, isNew = false, headingLevel = 2 }: ProductCardProps) {
  const Heading = `h${headingLevel}` as const
  const [selectedColor, setSelectedColor] = useState<string | null>(null)
  const titleId = `product-${product.id}`
  const color = selectedColor ?? product.defaultColor ?? null
  const productPath = `/shop/${encodeURIComponent(product.id)}`
  const href = color ? `${productPath}?${new URLSearchParams({ color }).toString()}` : productPath
  const colorVariantIds = new Set(product.variants.filter((variant) => variant.color === color).map(({ id }) => id))
  const image =
    selectedColor === null
      ? product.image
      : product.images.find(
          (image) => image.variantIds.length > 0 && image.variantIds.every((id) => colorVariantIds.has(id))
        )
  const artworkColor =
    selectedColor === null ? product.artwork?.backgroundColor : product.colors.find((item) => item.name === color)?.hex
  const artwork =
    image && product.artwork && artworkColor && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(artworkColor)
      ? product.artwork
      : null
  const availableColors = orderProductColors(product).filter((color) =>
    product.variants.some((variant) => variant.available && variant.color === color.name)
  )

  return (
    <article aria-labelledby={titleId} className="group h-full min-w-0">
      <ProductCardLink href={href} labelledBy={titleId} hasArtwork={artwork !== null}>
        <div
          className={`product-card-media relative flex aspect-square items-center justify-center overflow-hidden bg-transparent ${artwork ? "product-card-media-with-artwork" : ""}`}
        >
          {image ? (
            <Image
              src={image.src}
              alt={image.alt}
              width={800}
              height={1000}
              sizes="(min-width: 1336px) 322px, (min-width: 1024px) calc(33.33vw - 124px), (min-width: 640px) 50vw, calc(100vw - 32px)"
              unoptimized={!canOptimizeProductImage(image.src)}
              loading={priority ? "eager" : "lazy"}
              fetchPriority={priority ? "high" : undefined}
              className={`product-card-mockup h-full w-full object-contain ${image.origin === "store" ? "" : "mix-blend-multiply"} transition-transform duration-300 motion-safe:group-hover:scale-[1.025]`}
            />
          ) : (
            <p className="px-4 text-center text-sm text-muted-foreground">
              {selectedColor ? "No photo for this color yet" : "Product image coming soon"}
            </p>
          )}
          {artwork && artworkColor ? (
            <div className="product-card-artwork absolute inset-0">
              <ProductArtworkImage
                src={artwork.src}
                alt={artwork.alt}
                backgroundColor={artworkColor}
                sizes="(min-width: 1024px) 30vw, (min-width: 640px) 50vw, 100vw"
              />
            </div>
          ) : null}
          {/* Last child, so it paints over the artwork overlay that appears on hover and focus. */}
          {isNew ? <NewProductBadge /> : null}
        </div>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <Heading id={titleId} className="font-condensed text-lg leading-tight font-semibold break-words sm:text-xl">
            {displayProductTitle(product.title)}
          </Heading>
          {product.availability === "unavailable" ? (
            <p className="text-xs text-muted-foreground">Currently unavailable</p>
          ) : product.price ? (
            <p className="text-sm whitespace-nowrap">
              {product.price.min !== product.price.max ? "From " : ""}
              {usd.format(product.price.min / 100)}
              <span className="sr-only"> USD</span>
            </p>
          ) : null}
        </div>
      </ProductCardLink>
      {availableColors.length > 0 ? (
        <div role="group" aria-label="Available colors" className="mt-3 flex flex-wrap items-center gap-1">
          {availableColors.map((item) => (
            <button
              key={item.name}
              type="button"
              className="color-option"
              aria-label={item.name}
              aria-pressed={color === item.name}
              title={item.name}
              onClick={() => setSelectedColor(item.name)}
            >
              <span style={{ background: item.hex ?? "#e1ddd3" }} />
            </button>
          ))}
        </div>
      ) : null}
    </article>
  )
}
