import { describe, expect, it } from "vitest"

import { canOptimizeProductImage } from "./can-optimize-product-image"

describe("canOptimizeProductImage", () => {
  const blobHost = "productimages.public.blob.vercel-storage.com"
  const hostedPath = `/published-mockups/v1/${"a".repeat(64)}.jpg`

  it("optimizes the published artwork path only on the configured public store", () => {
    const path = `/published-artwork/v1/${"a".repeat(64)}.webp`
    expect(canOptimizeProductImage(`https://${blobHost}${path}`, blobHost)).toBe(true)
    expect(canOptimizeProductImage(`https://other.public.blob.vercel-storage.com${path}`, blobHost)).toBe(false)
    expect(canOptimizeProductImage(`https://${blobHost}/concepts/private-master.png`, blobHost)).toBe(false)
    expect(canOptimizeProductImage(`https://${blobHost}${path}?download=1`, blobHost)).toBe(false)
  })

  it("optimizes immutable images only from the configured public store", () => {
    expect(canOptimizeProductImage(`https://${blobHost}${hostedPath}`, blobHost)).toBe(true)
    expect(canOptimizeProductImage(`https://other.public.blob.vercel-storage.com${hostedPath}`, blobHost)).toBe(false)
    expect(canOptimizeProductImage(`https://${blobHost}${hostedPath}?width=900`, blobHost)).toBe(false)
    expect(canOptimizeProductImage(`https://${blobHost}${hostedPath}#fragment`, blobHost)).toBe(false)
    expect(canOptimizeProductImage(`https://${blobHost}/unrelated.jpg`, blobHost)).toBe(false)
  })

  it("optimizes content-addressed store photos only as exact JPEG paths on the configured store", () => {
    const photo = `/published-product-photos/v1/${"b".repeat(64)}.jpg`
    expect(canOptimizeProductImage(`https://${blobHost}${photo}`, blobHost)).toBe(true)
    for (const src of [
      `https://${blobHost}${photo.replace(".jpg", ".png")}`,
      `https://${blobHost}${photo}?width=900`,
      `https://other.public.blob.vercel-storage.com${photo}`,
      `https://${blobHost}/published-product-photos/v1/${"b".repeat(63)}.jpg`,
      `https://${blobHost}/published-product-photos/v1/${"B".repeat(64)}.jpg`,
      `https://${blobHost}/product-gallery/v1/${"b".repeat(64)}.jpg`,
    ])
      expect(canOptimizeProductImage(src, blobHost)).toBe(false)
  })

  it("accepts provider mockups without changing garment camera parameters", () => {
    expect(
      canOptimizeProductImage(
        "https://images-api.printify.com/mockup/product/variant/camera/shirt.jpg?camera_label=person-1-front"
      )
    ).toBe(true)
  })

  it.each([
    "https://images.printify.com/mockup/shirt.jpg",
    "http://images-api.printify.com/mockup/shirt.jpg",
    "https://images-api.printify.com.attacker.example/mockup/shirt.jpg",
    "https://images-api.printify.com:8080/mockup/shirt.jpg",
    "https://user:password@images-api.printify.com/mockup/shirt.jpg",
    "https://images-api.printify.com/uploads/shirt.jpg",
    "https://images-api.printify.com/mockups/shirt.jpg",
    "https://images-api.printify.com/mockup/shirt.svg?camera_label=front",
    "https://images-api.printify.com/mockup/shirt.SVG",
    "/images/shirt.jpg",
    "data:image/svg+xml,%3Csvg%3E%3C/svg%3E",
    "blob:https://example.com/image",
    "not a URL",
  ])("preserves direct delivery for unsupported image %s", (src) => {
    expect(canOptimizeProductImage(src)).toBe(false)
  })
})
