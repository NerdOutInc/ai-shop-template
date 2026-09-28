import { env } from "@/lib/env"
import { readPublicArtworkLocation } from "@/lib/read-public-artwork-location"
import { isPublicBlobHost } from "@/lib/is-public-blob-host"

export function canOptimizeProductImage(src: string, blobHost = env.NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST): boolean {
  try {
    const url = new URL(src)
    return (
      url.protocol === "https:" &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      ((url.hostname === "images-api.printify.com" && url.pathname.startsWith("/mockup/")) ||
        (isPublicBlobHost(blobHost) &&
          url.hostname === blobHost &&
          (/^\/published-mockups\/v1\/[a-f0-9]{64}\.(jpg|png|webp)$/.test(url.pathname) ||
            readPublicArtworkLocation(src) !== null) &&
          !url.search)) &&
      !url.hash &&
      !url.pathname.toLowerCase().endsWith(".svg")
    )
  } catch {
    return false
  }
}
