import { describe, expect, it } from "vitest"
import { readGalleryImageLocation } from "./read-gallery-image-location"

const host = "galleryfixtures.public.blob.vercel-storage.com",
  sha = "c".repeat(64)

describe("gallery image location", () => {
  it("accepts only each source's immutable namespace on the configured public host", () => {
    expect(readGalleryImageLocation(`https://${host}/published-product-photos/v1/${sha}.jpg`, host, "store")).toEqual({
      pathname: `published-product-photos/v1/${sha}.jpg`,
      sha256: sha,
    })
    for (const extension of ["jpg", "png", "webp"])
      expect(
        readGalleryImageLocation(`https://${host}/published-mockups/v1/${sha}.${extension}`, host, "provider")?.sha256
      ).toBe(sha)
    expect(readGalleryImageLocation(`https://${host}/published-mockups/v1/${sha}.jpg`, host, "store")).toBeNull()
    expect(readGalleryImageLocation(`https://${host}/published-product-photos/v1/${sha}.jpg`, host, "provider")).toBe(
      null
    )
    expect(readGalleryImageLocation(`https://${host}/published-product-photos/v1/${sha}.png`, host, "store")).toBe(null)
  })

  it.each([
    [`http://${host}/published-product-photos/v1/${sha}.jpg`, host],
    [`https://${host}:8443/published-product-photos/v1/${sha}.jpg`, host],
    [`https://user:secret@${host}/published-product-photos/v1/${sha}.jpg`, host],
    [`https://${host}/published-product-photos/v1/${sha}.jpg?download=1`, host],
    [`https://${host}/published-product-photos/v1/${sha}.jpg#cover`, host],
    [`https://other.public.blob.vercel-storage.com/published-product-photos/v1/${sha}.jpg`, host],
    [`https://store.example/published-product-photos/v1/${sha}.jpg`, "store.example"],
    [`https://${host}/published-product-photos/v1/${sha}.jpg`, undefined],
    ["not a url", host],
  ])("refuses %s for host %s", (src, configured) => {
    expect(readGalleryImageLocation(src, configured, "store")).toBeNull()
  })
})
