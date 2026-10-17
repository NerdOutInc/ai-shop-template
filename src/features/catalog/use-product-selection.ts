"use client"

import { useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"

import type { CatalogProduct } from "./catalog-product"

function replaceSelection(color: string | null, size: string | null) {
  const url = new URL(window.location.href)
  if (color === null) url.searchParams.delete("color")
  else url.searchParams.set("color", color)
  if (size === null) url.searchParams.delete("size")
  else url.searchParams.set("size", size)
  if (url.href !== window.location.href) {
    // Next's history integration updates useSearchParams without navigation or a new history entry.
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`)
  }
}

export function useProductSelection(product: CatalogProduct) {
  const [clearedSelection, setClearedSelection] = useState<{
    productId: string
    color: string
    size: string
  } | null>(null)
  const searchParams = useSearchParams()
  const query = searchParams.toString()
  const requestedColor = searchParams.get("color")
  const requestedSize = searchParams.get("size")
  const color =
    (product.colors.some((item) => item.name === requestedColor) ? requestedColor : null) ??
    product.defaultColor ??
    product.variants.find((variant) => variant.available)?.color ??
    product.colors[0]?.name ??
    null
  // Keep a recognized sold-out choice visible, but never turn an invalid pair into a different size.
  const size = product.variants.some((variant) => variant.color === color && variant.size === requestedSize)
    ? requestedSize
    : null

  useEffect(() => {
    let cancelled = false
    const href = window.location.href
    // Wait for Next's parent effect to install its history integration on initial hydration.
    queueMicrotask(() => {
      if (
        !cancelled &&
        window.location.href === href &&
        new URLSearchParams(window.location.search).toString() === query
      ) {
        replaceSelection(color, size)
      }
    })
    return () => {
      cancelled = true
    }
  }, [color, size, query])

  function selectColor(nextColor: string) {
    const nextSize = product.variants.some(
      (variant) => variant.color === nextColor && variant.size === size && variant.available
    )
      ? size
      : null
    if (nextColor !== color || nextSize !== size) {
      setClearedSelection(size !== null && nextSize === null ? { productId: product.id, color: nextColor, size } : null)
    }
    replaceSelection(nextColor, nextSize)
  }

  function selectSize(nextSize: string) {
    setClearedSelection(null)
    replaceSelection(color, nextSize)
  }

  const unavailableSize =
    clearedSelection?.productId === product.id && clearedSelection.color === color && size === null
      ? clearedSelection.size
      : null

  return { color, size, unavailableSize, selectColor, selectSize }
}
