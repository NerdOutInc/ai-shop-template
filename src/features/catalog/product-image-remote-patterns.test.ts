// The matcher next/image uses; on a Next upgrade, follow its new path rather than drop the assertion.
import { hasRemoteMatch } from "next/dist/shared/lib/match-remote-pattern"
import { describe, expect, it } from "vitest"

import { canOptimizeProductImage } from "./can-optimize-product-image"
import { productImageRemotePatterns } from "./product-image-remote-patterns"

describe("productImageRemotePatterns", () => {
  const blobHost = "productimages.public.blob.vercel-storage.com"
  const hash = "b".repeat(64)
  const matches = (src: string, host: string | undefined) =>
    hasRemoteMatch([], productImageRemotePatterns(host), new URL(src))

  it("lets the optimizer fetch every content-addressed Blob path that product images may use", () => {
    for (const path of [
      `/published-mockups/v1/${hash}.jpg`,
      `/published-product-photos/v1/${hash}.jpg`,
      `/published-artwork/v1/${hash}.webp`,
    ]) {
      const src = `https://${blobHost}${path}`
      expect(canOptimizeProductImage(src, blobHost)).toBe(true)
      expect(matches(src, blobHost)).toBe(true)
      expect(matches(`${src}?width=900`, blobHost)).toBe(false)
      expect(matches(`https://other.public.blob.vercel-storage.com${path}`, blobHost)).toBe(false)
      expect(matches(src, undefined)).toBe(false)
    }
  })

  it("keeps private gallery uploads and other Blob paths out of the optimizer", () => {
    expect(matches(`https://${blobHost}/product-gallery/v1/${hash}.jpg`, blobHost)).toBe(false)
    expect(matches(`https://${blobHost}/concepts/private-master.png`, blobHost)).toBe(false)
  })

  it("keeps provider camera labels on Printify mockups", () => {
    const src = "https://images-api.printify.com/mockup/product/variant/camera/shirt.jpg?camera_label=front"
    expect(matches(src, blobHost)).toBe(true)
    expect(matches(src, undefined)).toBe(true)
  })
})
