"use client"

import Image from "next/image"
import { useCallback, useEffect, useState } from "react"

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel"

import type { CatalogProduct } from "./catalog-product"
import { canOptimizeProductImage } from "./can-optimize-product-image"
import { NewProductBadge } from "./new-product-badge"
import { ProductArtworkImage } from "./product-artwork-image"

type ProductImageGalleryProps = {
  title: string
  images: NonNullable<CatalogProduct["image"]>[]
  artwork: (NonNullable<CatalogProduct["artwork"]> & { backgroundColor: string }) | null
  placeholder: string
  isNew?: boolean
  initialIndex?: number
  onSlideSelect: (index: number) => void
}

export function ProductImageGallery({
  title,
  images,
  artwork,
  placeholder,
  isNew = false,
  initialIndex = 0,
  onSlideSelect,
}: ProductImageGalleryProps) {
  const [api, setApi] = useState<CarouselApi>()
  const [startIndex] = useState(initialIndex)
  const [selected, setSelected] = useState(startIndex)
  // Keep the missing-photo message as the first slide when only artwork is available.
  const photoCount = Math.max(images.length, 1)
  const count = photoCount + (artwork ? 1 : 0)
  const onSelect = useCallback(
    (carousel: NonNullable<CarouselApi>) => {
      const index = carousel.selectedScrollSnap()
      setSelected(index)
      onSlideSelect(index)
    },
    [onSlideSelect]
  )

  function selectSlide(index: number) {
    // Embla emits no select event for the current snap; an explicit click still chooses that view.
    if (api?.selectedScrollSnap() === index) onSlideSelect(index)
    else api?.scrollTo(index)
  }

  useEffect(() => {
    if (!api) return
    // A resize can reinitialize Embla while showing a fallback; it is not a new photo choice.
    const onReInit = (carousel: NonNullable<CarouselApi>) => setSelected(carousel.selectedScrollSnap())
    api.on("select", onSelect)
    api.on("reInit", onReInit)
    return () => {
      api.off("select", onSelect)
      api.off("reInit", onReInit)
    }
  }, [api, onSelect])

  return (
    <Carousel
      className="product-gallery min-w-0"
      aria-label={`${title} photos`}
      tabIndex={0}
      opts={{ loop: count > 1, startIndex }}
      setApi={setApi}
    >
      <div className="relative">
        <CarouselContent className="product-gallery-track ml-0">
          {images.length ? (
            images.map((item, index) => (
              <CarouselItem
                key={`${item.src}-${index}`}
                className="bg-background pl-0"
                aria-label={`${index + 1} of ${count}`}
                aria-hidden={selected !== index}
              >
                <Image
                  className="product-main-image"
                  src={item.src}
                  alt={item.alt}
                  width={1000}
                  height={1000}
                  sizes="(max-width: 640px) calc(100vw - 32px), (max-width: 850px) calc(57.5vw - 45px), (max-width: 1335px) calc(57.5vw - 92px), 677px"
                  unoptimized={!canOptimizeProductImage(item.src)}
                  loading={index === startIndex ? "eager" : "lazy"}
                  fetchPriority={index === startIndex ? "high" : undefined}
                  draggable={false}
                />
              </CarouselItem>
            ))
          ) : (
            <CarouselItem className="pl-0" aria-label={`1 of ${count}`} aria-hidden={selected !== 0}>
              <div className="flex aspect-square items-center justify-center bg-muted">{placeholder}</div>
            </CarouselItem>
          )}
          {artwork && (
            <CarouselItem className="pl-0" aria-label={`${count} of ${count}`} aria-hidden={selected !== photoCount}>
              <ProductArtworkImage
                src={artwork.src}
                alt={artwork.alt}
                backgroundColor={artwork.backgroundColor}
                sizes="(max-width: 640px) 100vw, 55vw"
              />
            </CarouselItem>
          )}
        </CarouselContent>
        {count > 1 && (
          <>
            <CarouselPrevious variant="secondary" className="left-3 size-11" />
            <CarouselNext variant="secondary" className="right-3 size-11" />
          </>
        )}
        {/* On the frame rather than a slide, so it stays put while the photos and artwork scroll. */}
        {isNew && <NewProductBadge />}
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        Image {selected + 1} of {count}
      </p>
      {(images.length > 1 || artwork) && (
        <div className="product-thumbnails" aria-label="Choose product photo">
          {images.map((item, index) => (
            <button
              key={`${item.src}-${index}`}
              type="button"
              className="product-thumbnail"
              aria-label={`View photo ${index + 1} of ${title}`}
              aria-pressed={selected === index}
              onClick={() => selectSlide(index)}
            >
              <Image
                src={item.src}
                alt=""
                width={100}
                height={100}
                sizes="(max-width: 640px) 56px, 74px"
                unoptimized={!canOptimizeProductImage(item.src)}
              />
            </button>
          ))}
          {artwork && (
            <button
              type="button"
              className="product-thumbnail"
              aria-label={`View artwork of ${title}`}
              aria-pressed={selected === photoCount}
              onClick={() => selectSlide(photoCount)}
            >
              <ProductArtworkImage src={artwork.src} alt="" backgroundColor={artwork.backgroundColor} sizes="82px" />
            </button>
          )}
        </div>
      )}
    </Carousel>
  )
}
