import type { LibraryArtworkRevision, LibraryAsset } from "@/features/design-library/library-types"
import type { DisplayImageSize } from "@/features/design-library/display-image-sizes"

export type ConceptArtworkSource = {
  src: string
  width: number | null
  height: number | null
  transparent: boolean
}

/**
 * Picks what a card or detail view should actually load.
 *
 * Prepared transparent artwork is a print master, so it is always requested at a browsing
 * size; the route derives and caches that once. Artwork still awaiting preparation has no
 * browsing size, so its existing preview is used as-is and the caller knows not to offer
 * garment colours for it.
 */
export function getConceptArtworkSource(
  revision: LibraryArtworkRevision | null,
  size: DisplayImageSize
): ConceptArtworkSource | null {
  const ready = (asset: LibraryAsset | null | undefined) => (asset?.status === "ready" ? asset : null)
  const transparent = [revision?.print, revision?.original, revision?.preview]
    .map(ready)
    .find((asset) => asset?.hasAlpha === true && asset.hasTransparency === true)
  if (transparent)
    return {
      src: `${transparent.url}?size=${size}`,
      // The derivative keeps the source aspect ratio, so the intrinsic ratio still holds
      // and the browser reserves the right box before the image arrives.
      width: transparent.width,
      height: transparent.height,
      transparent: true,
    }
  const fallback = [revision?.preview, revision?.original, revision?.print].map(ready).find(Boolean)
  if (!fallback) return null
  return { src: fallback.url, width: fallback.width, height: fallback.height, transparent: false }
}
