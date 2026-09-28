"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"

import { trackStoreEvent } from "@/features/analytics/track-store-event"
import { metaPixel } from "@/features/analytics/meta-pixel"
import { useMetaPixel } from "@/features/analytics/use-meta-pixel"
import type { CartItem } from "@/features/cart/cart-item"
import { useCart } from "@/features/cart/use-cart"
import { getShippingPolicySummary } from "@/features/store-policies/get-shipping-policy-summary"
import { ShippingEstimateText } from "@/features/store-policies/shipping-estimate-text"

import { AddToCartConfirmation } from "./add-to-cart-confirmation"
import type { CatalogProduct } from "./catalog-product"
import { displayProductTitle } from "./display-product-title"
import { getGarmentDescriptionBlocks } from "./get-garment-description-blocks"
import { getProductIntroduction } from "./get-product-introduction"
import { getProductGarmentLabels } from "./get-product-garment-labels"
import { orderProductColors } from "./order-product-colors"
import { ProductDescription } from "./product-description"
import { ProductImageGallery } from "./product-image-gallery"
import { useProductSelection } from "./use-product-selection"

const sizeOrder = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"]
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

type PhotoSelection = { src: string; viewKey?: string; index: number }

function selectedPhotoIndex(images: NonNullable<CatalogProduct["image"]>[], photo?: PhotoSelection) {
  if (!photo) return 0
  const matchingIndex = images.findIndex((image) => image.src === photo.src)
  if (matchingIndex !== -1) return matchingIndex
  // Primary mockups can reorder the photos; a known camera view takes precedence over position.
  if (photo.viewKey)
    return Math.max(
      0,
      images.findIndex((image) => image.viewKey === photo.viewKey)
    )
  return photo.index < images.length ? photo.index : 0
}

export function ProductDetails({
  product,
  preview = false,
  isNew = false,
}: {
  product: CatalogProduct
  preview?: boolean
  /** From getCatalogProduct, so the page never reads a clock while it renders. */
  isNew?: boolean
}) {
  const { addItem } = useCart()
  const shippingPolicy = getShippingPolicySummary()
  const { color, size, selectColor, selectSize } = useProductSelection(product)
  const colorVariantIds = new Set(product.variants.filter((item) => item.color === color).map((item) => item.id))
  const gallery = product.images.filter((item) => item.variantIds.some((id) => colorVariantIds.has(id)))
  const images = gallery.length ? gallery : color === null && product.image ? [product.image] : []
  const initialSelection = {
    productId: product.id,
    photo: images[0] ? { src: images[0].src, viewKey: images[0].viewKey, index: 0 } : undefined,
    artwork: false,
  }
  const [gallerySelection, setGallerySelection] = useState<{
    productId: string
    photo?: PhotoSelection
    artwork: boolean
  }>(initialSelection)
  if (gallerySelection.productId !== product.id) setGallerySelection(initialSelection)
  const [message, setMessage] = useState("")
  const [addedItem, setAddedItem] = useState<CartItem | null>(null)
  const [confirmationOpen, setConfirmationOpen] = useState(false)
  const addButton = useRef<HTMLButtonElement>(null)
  const [sizeGuideOpen, setSizeGuideOpen] = useState(false)
  const sizeGuideSummary = useRef<HTMLElement>(null)
  const viewedProductId = useRef<string | null>(null)
  const metaViewedProductId = useRef<string | null>(null)
  const { ready: metaReady } = useMetaPixel()

  useEffect(() => {
    if (preview || viewedProductId.current === product.id) return
    viewedProductId.current = product.id
    trackStoreEvent({ name: "product_viewed", productId: product.id })
  }, [product.id, preview])

  useEffect(() => {
    if (preview || !metaReady || metaViewedProductId.current === product.id) return
    if (metaPixel.track({ name: "ViewContent", productId: product.id })) metaViewedProductId.current = product.id
  }, [product.id, metaReady, preview])

  const title = displayProductTitle(product.title)
  const garment = getProductGarmentLabels(product)
  const garmentDescription = getGarmentDescriptionBlocks(product)
  const sizes = [
    ...new Set(product.variants.map((variant) => variant.size).filter((value): value is string => value !== null)),
  ].toSorted((a, b) => {
    const first = sizeOrder.indexOf(a)
    const second = sizeOrder.indexOf(b)
    return (first === -1 ? sizeOrder.length : first) - (second === -1 ? sizeOrder.length : second)
  })
  const variant = product.variants.find((item) => item.color === color && item.size === size && item.available)
  const selectedVariant = variant ?? product.variants.find((item) => item.color === color && item.size === size)
  const selection = gallerySelection.productId === product.id ? gallerySelection : initialSelection
  const photoIndex = selectedPhotoIndex(images, selection.photo)
  const selectedImage = images[photoIndex] ?? (color === null ? product.image : null)
  const artworkColor =
    color === null ? product.artwork?.backgroundColor : product.colors.find((item) => item.name === color)?.hex
  const artwork =
    product.artwork && artworkColor && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(artworkColor) ? product.artwork : null
  const galleryIndex = selection.artwork && artwork ? Math.max(images.length, 1) : photoIndex
  const price = selectedVariant?.price ?? product.price?.min
  const selectedSizeExists = !sizes.length || size !== null
  const colorAvailable = product.variants.some((item) => item.color === color && item.available)
  const measurements = product.sizeGuide?.measurements.filter((row) => !/^size\s+tolerance\b/i.test(row.label.trim()))

  function addToCart() {
    if (preview || !variant) return
    const item: CartItem = {
      productId: product.id,
      variantId: variant.id,
      title,
      variantTitle: variant.title,
      // The artwork URL alone would lose its garment-color background in the cart.
      image: selectedImage?.src,
      unitAmount: variant.price,
      quantity: 1,
    }
    if (addItem(item)) {
      trackStoreEvent({ name: "add_to_cart", productId: product.id })
      metaPixel.track({ name: "AddToCart", items: [item] })
      setMessage("")
      setAddedItem(item)
      setConfirmationOpen(true)
    } else {
      setMessage("Your cart is full for this item. You can adjust quantities in your cart.")
    }
  }

  return (
    <div className="product-layout">
      <ProductImageGallery
        key={`${product.id}-${color}`}
        title={title}
        images={images}
        artwork={artwork && artworkColor ? { ...artwork, backgroundColor: artworkColor } : null}
        placeholder={color ? "No photo for this color yet" : "Product image coming soon"}
        isNew={isNew}
        initialIndex={galleryIndex}
        onSlideSelect={(index) => {
          const photo = images[index] ?? selectedImage
          setGallerySelection({
            productId: product.id,
            // Cart receipts keep a garment photo, including while viewing the artwork.
            photo: photo
              ? { src: photo.src, viewKey: photo.viewKey, index: images[index] ? index : photoIndex }
              : undefined,
            artwork: Boolean(artwork) && index === Math.max(images.length, 1),
          })
        }}
      />
      <section className="product-info" aria-label="Product options">
        {(garment.modelLabel || garment.typeLabel) && (
          <div className="mb-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {garment.modelLabel && <span>{garment.modelLabel}</span>}
            {garment.modelLabel && garment.typeLabel && <span aria-hidden="true">/</span>}
            {garment.typeLabel && <span>{garment.typeLabel}</span>}
          </div>
        )}
        <div className="flex items-start justify-between gap-5">
          <h1 className="product-name font-display">{title}</h1>
          {price !== undefined && price !== null && (
            <p className="product-price font-condensed">
              {!selectedVariant && product.price?.min !== product.price?.max ? (
                <span className="block text-right text-sm font-normal">From</span>
              ) : null}
              {usd.format(price / 100)}
            </p>
          )}
        </div>
        <p className="product-story">{getProductIntroduction(product)}</p>
        {product.colors.length > 0 && (
          <fieldset className="product-option">
            <legend>
              Color <span className="ml-1 text-sm font-normal text-muted-foreground">{color}</span>
            </legend>
            <div className="product-colors">
              {orderProductColors(product).map((item) => (
                <button
                  type="button"
                  className="color-option"
                  key={item.name}
                  title={item.name}
                  aria-label={item.name}
                  aria-pressed={color === item.name}
                  disabled={!product.variants.some((variant) => variant.color === item.name && variant.available)}
                  onClick={() => {
                    selectColor(item.name)
                    setMessage("")
                  }}
                >
                  <span style={{ background: item.hex ?? "#e1ddd3" }} />
                </button>
              ))}
            </div>
          </fieldset>
        )}
        {sizes.length > 0 && (
          <fieldset className="product-option">
            <legend>Size{size ? `: ${size}` : ""}</legend>
            <div className="size-options">
              {sizes.map((value) => (
                <button
                  type="button"
                  className="size-option"
                  key={value}
                  aria-pressed={size === value}
                  disabled={
                    !product.variants.some((item) => item.color === color && item.size === value && item.available)
                  }
                  onClick={() => {
                    selectSize(value)
                    setMessage("")
                  }}
                >
                  {value}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="mt-3 inline-flex min-h-11 items-center text-sm underline underline-offset-4"
              aria-controls="size-guide"
              onClick={() => {
                setSizeGuideOpen(true)
                sizeGuideSummary.current?.focus()
              }}
            >
              Find your fit
            </button>
          </fieldset>
        )}
        <button
          ref={addButton}
          type="button"
          className="button button-coral w-full"
          disabled={preview || !variant}
          aria-describedby={preview ? "preview-purchase-note" : undefined}
          onClick={addToCart}
        >
          {confirmationOpen
            ? "Added to cart"
            : product.availability === "unavailable"
              ? "Currently unavailable"
              : !colorAvailable
                ? "This color is unavailable"
                : !selectedSizeExists
                  ? "Choose a size"
                  : !variant
                    ? "This option is unavailable"
                    : "Add to cart"}
        </button>
        {preview && (
          <p id="preview-purchase-note" className="pt-3 text-center text-sm text-muted-foreground">
            Purchasing is disabled in admin preview.
          </p>
        )}
        <div role="status" aria-live="polite">
          {message && (
            <p className="mt-3 text-sm">
              {message}
              <Link className="ml-2 inline-flex min-h-11 items-center underline underline-offset-4" href="/cart">
                View cart
              </Link>
            </p>
          )}
        </div>
        {!preview && (
          <AddToCartConfirmation
            item={addedItem}
            open={confirmationOpen}
            onOpenChange={setConfirmationOpen}
            returnFocus={addButton}
          />
        )}
        <p className="pt-3 text-center text-sm text-muted-foreground">Made for you.</p>
        {garmentDescription.length > 0 && (
          <details className="product-detail-disclosure">
            <summary>The garment</summary>
            <ProductDescription blocks={garmentDescription} />
          </details>
        )}
        <details
          id="size-guide"
          className="product-detail-disclosure"
          open={sizeGuideOpen}
          onToggle={(event) => setSizeGuideOpen(event.currentTarget.open)}
        >
          <summary ref={sizeGuideSummary}>Size guide</summary>
          {product.sizeGuide && measurements?.length ? (
            <div
              className="size-guide"
              tabIndex={0}
              role="region"
              aria-label="Size chart, scroll horizontally for more sizes"
            >
              <table>
                <caption>
                  Measurements supplied by the print provider. Compare with a favorite garment laid flat.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Measurement</th>
                    {product.sizeGuide.sizes.map((value, index) => (
                      <th key={index} scope="col">
                        {value}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {measurements.map((row) => (
                    <tr key={row.label}>
                      <th scope="row">{row.label}</th>
                      {row.values.map((value, index) => (
                        <td key={index}>{value}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>A size chart isn’t available for this garment yet. Please check back before choosing your fit.</p>
          )}
        </details>
        <details className="product-detail-disclosure">
          <summary>Shipping & care</summary>
          <p>
            Each item is printed to order. US shipping is {shippingPolicy.rate}, shown in your cart. Enter your delivery
            details at secure checkout.
          </p>
          <p>
            <ShippingEstimateText>{shippingPolicy.delivery}</ShippingEstimateText> Arrival dates are estimates.
          </p>
          <p>
            Machine wash cold, inside out, with similar colors. Tumble dry low. Keep the iron off the print—it’s already
            had its warm-up.
          </p>
          <Link
            className="mb-4 inline-flex min-h-11 items-center text-sm underline underline-offset-4"
            href="/shipping"
          >
            More about shipping & care
          </Link>
        </details>
      </section>
    </div>
  )
}
