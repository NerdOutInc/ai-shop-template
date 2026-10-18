"use client"

import { useState } from "react"
import type { CatalogProduct } from "./catalog-product"

type PhotoSelection = { src: string; viewKey?: string; index: number }
type GallerySelection = { productId: string; photo?: PhotoSelection; artwork: boolean }

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

export function useProductGallerySelection({
  productId,
  images,
  hasArtwork,
}: {
  productId: string
  images: NonNullable<CatalogProduct["image"]>[]
  hasArtwork: boolean
}) {
  const initialSelection = {
    productId,
    photo: images[0] ? { src: images[0].src, viewKey: images[0].viewKey, index: 0 } : undefined,
    artwork: false,
  }
  const [selection, setSelection] = useState<GallerySelection>(initialSelection)
  if (selection.productId !== productId) setSelection(initialSelection)
  const current = selection.productId === productId ? selection : initialSelection
  const photoIndex = selectedPhotoIndex(images, current.photo)
  const selectedImage = images[photoIndex]
  // Refresh edits to the chosen photo without turning a temporary fallback into a new preference.
  if (
    current.photo &&
    selectedImage?.src === current.photo.src &&
    (selectedImage.viewKey !== current.photo.viewKey || photoIndex !== current.photo.index)
  ) {
    setSelection({
      ...current,
      photo: { src: selectedImage.src, viewKey: selectedImage.viewKey, index: photoIndex },
    })
  }

  return {
    selectedImage,
    index: current.artwork && hasArtwork ? Math.max(images.length, 1) : photoIndex,
    selectSlide(index: number) {
      const photo = images[index] ?? selectedImage
      setSelection({
        productId,
        // Keep a garment photo for cart receipts while the artwork is selected.
        photo: photo
          ? { src: photo.src, viewKey: photo.viewKey, index: images[index] ? index : photoIndex }
          : undefined,
        artwork: hasArtwork && index === Math.max(images.length, 1),
      })
    },
  }
}
