"use client"

import Image from "next/image"
import { useState } from "react"

import { displayColorText } from "@/lib/display-color-text"
import { displayColorName } from "@/lib/display-color-name"

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
  /**
   * The color the shop's color filter chose for this product, or null when the filter is off. It
   * replaces the default color and cover photo, and a change to it forgets the shopper's own swatch
   * click on this card, so every card follows the filter together.
   */
  filteredColor?: string | null
  /**
   * Identifies the filter selection behind `filteredColor`. A change to it also forgets the swatch
   * click, since toggling a family can leave this product's matched color unchanged (Black plus
   * Blue still matches Black first). Sorting leaves it alone, so clicks survive a re-sort.
   */
  filterKey?: string
}
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

export function ProductCard({
  product,
  priority = false,
  isNew = false,
  headingLevel = 2,
  filteredColor = null,
  filterKey = "",
}: ProductCardProps) {
  const Heading = `h${headingLevel}` as const
  const [selectedColor, setSelectedColor] = useState<string | null>(null)
  // Any change to the filter forgets the click, including a change back to the filter it was made
  // under. Resetting during render, rather than in an effect, never paints the stale swatch.
  const [seenFilter, setSeenFilter] = useState({ filteredColor, filterKey })
  if (seenFilter.filteredColor !== filteredColor || seenFilter.filterKey !== filterKey) {
    setSeenFilter({ filteredColor, filterKey })
    setSelectedColor(null)
  }
  const titleId = `product-${product.id}`
  const color = selectedColor ?? filteredColor ?? product.defaultColor ?? null
  const usesCoverPhoto = selectedColor === null && (filteredColor === null || filteredColor === product.defaultColor)
  const productPath = `/shop/${encodeURIComponent(product.id)}`
  const href = color ? `${productPath}?${new URLSearchParams({ color }).toString()}` : productPath
  const colorVariantIds = new Set(product.variants.filter((variant) => variant.color === color).map(({ id }) => id))
  const image = usesCoverPhoto
    ? product.image
    : product.images.find(
        (image) => image.variantIds.length > 0 && image.variantIds.every((id) => colorVariantIds.has(id))
      )
  const artworkColor = usesCoverPhoto
    ? product.artwork?.backgroundColor
    : product.colors.find((item) => item.name === color)?.hex
  const artwork =
    image && product.artwork && artworkColor && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(artworkColor)
      ? product.artwork
      : null
  const availableColors = orderProductColors(product).filter((color) =>
    product.variants.some((variant) => variant.available && variant.color === color.name)
  )

  return (
    <article aria-labelledby={titleId} className="group h-full min-w-0">
      {/*
       * The link holds only the images and is named by the heading. Its pseudo-element stretches over
       * this box, so the title and price stay clickable without being link text: axe's
       * label-content-name-mismatch requires every visible word inside a link to be part of its name,
       * and the name should stay the title alone. The media box is positioned, so it paints above the
       * stretch and still receives the artwork touch gestures.
       */}
      <div className="relative">
        <ProductCardLink href={href} labelledBy={titleId} hasArtwork={artwork !== null}>
          <div
            className={`product-card-media relative flex aspect-square items-center justify-center overflow-hidden bg-transparent ${artwork ? "product-card-media-with-artwork" : ""}`}
          >
            {image ? (
              <Image
                src={image.src}
                alt={displayColorText(
                  image.alt,
                  product.colors.map(({ name }) => name)
                )}
                width={800}
                height={1000}
                sizes="(min-width: 1336px) 322px, (min-width: 1024px) calc(33.33vw - 124px), (min-width: 640px) 50vw, calc(100vw - 32px)"
                unoptimized={!canOptimizeProductImage(image.src)}
                loading={priority ? "eager" : "lazy"}
                fetchPriority={priority ? "high" : undefined}
                className={`product-card-mockup h-full w-full object-contain ${image.origin === "store" ? "" : "mix-blend-multiply"} transition-transform duration-300 motion-safe:group-hover:scale-[1.025]`}
              />
            ) : null}
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
          </div>
        </ProductCardLink>
        {image ? null : (
          // Centered in the square media box, which fills the top of this box at the same width.
          <p className="pointer-events-none absolute inset-x-0 top-0 flex aspect-square items-center justify-center px-4 text-center text-sm text-muted-foreground">
            {usesCoverPhoto ? "Product image coming soon" : "No photo for this color yet"}
          </p>
        )}
        {/* After the link, so it paints over the artwork overlay that appears on hover and focus. */}
        {isNew ? <NewProductBadge /> : null}
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
      </div>
      {availableColors.length > 0 ? (
        <div role="group" aria-label="Available colors" className="mt-3 flex flex-wrap items-center gap-1">
          {availableColors.map((item) => (
            <button
              key={item.name}
              type="button"
              className="color-option"
              aria-label={displayColorName(item.name)}
              aria-pressed={color === item.name}
              title={displayColorName(item.name)}
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
