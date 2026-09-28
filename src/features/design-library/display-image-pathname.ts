import type { DisplayImageSize } from "./display-image-sizes"

/**
 * Content-addressed by the source asset's hash, so new artwork lands on a new path and a
 * stale derivative can never be served for a replaced master.
 */
export function displayImagePathname(asset: { id: string; sha256: string | null }, size: DisplayImageSize) {
  if (!/^[a-f0-9-]{36}$/.test(asset.id) || !asset.sha256 || !/^[a-f0-9]{64}$/.test(asset.sha256))
    throw new Error("A private asset needs a valid identity and content hash")
  return `concepts/${asset.id}/${asset.sha256}-${size}.webp`
}
