import { isPublicBlobHost } from "@/lib/is-public-blob-host"

export function readGalleryImageLocation(src: string, host: string | undefined, kind: "store" | "provider") {
  try {
    const url = new URL(src)
    const pattern =
      kind === "store"
        ? /^\/published-product-photos\/v1\/([a-f0-9]{64})\.jpg$/
        : /^\/published-mockups\/v1\/([a-f0-9]{64})\.(jpg|png|webp)$/
    const match = pattern.exec(url.pathname)
    return isPublicBlobHost(host) &&
      url.protocol === "https:" &&
      url.hostname === host &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      match
      ? { pathname: url.pathname.slice(1), sha256: match[1]! }
      : null
  } catch {
    return null
  }
}
