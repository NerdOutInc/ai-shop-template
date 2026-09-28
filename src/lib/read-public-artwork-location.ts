import { isPublicBlobHost } from "./is-public-blob-host"

export function readPublicArtworkLocation(value: unknown) {
  if (typeof value !== "string" || value !== value.trim()) return null
  try {
    const url = new URL(value)
    const match = /^\/published-artwork\/v1\/([a-f0-9]{64})\.webp$/.exec(url.pathname)
    if (
      url.protocol !== "https:" ||
      !isPublicBlobHost(url.hostname) ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      !match
    )
      return null
    return { url: url.href, hostname: url.hostname, pathname: url.pathname.slice(1), sha256: match[1]! }
  } catch {
    return null
  }
}
