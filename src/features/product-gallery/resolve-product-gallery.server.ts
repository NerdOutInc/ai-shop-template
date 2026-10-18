import "server-only"
import { galleryManifestSchema } from "./gallery-manifest-schema"
import { readGallerySource } from "./read-gallery-source.server"
import { readGalleryImageLocation } from "./read-gallery-image-location"
import { isGalleryBindingCurrent } from "./is-gallery-binding-current.server"

export type GalleryResolution = {
  snapshot: Record<string, unknown>
  withheldVariantIds: number[]
  diagnostic: string | null
  staleColors: string[]
  invalidColors: string[]
}
export function resolveProductGallery(input: {
  snapshot: Record<string, unknown>
  active: unknown
  revision: string
  blobHost?: string
  history?: Record<string, Record<string, unknown>>
}): GalleryResolution {
  const snapshot = { ...input.snapshot }
  delete snapshot.storefront_gallery_withheld_variants
  if (input.active === null || input.active === undefined)
    return { snapshot, diagnostic: null, staleColors: [], invalidColors: [], withheldVariantIds: [] }
  const invalid = () => ({
    snapshot: {
      ...snapshot,
      images: [],
    },
    withheldVariantIds: Array.isArray(snapshot.variants)
      ? snapshot.variants.flatMap((v) =>
          v &&
          typeof v === "object" &&
          "is_enabled" in v &&
          v.is_enabled === true &&
          "id" in v &&
          Number.isSafeInteger(v.id)
            ? [v.id as number]
            : []
        )
      : [],
    diagnostic: "The active gallery cannot be read. Restore a saved revision or use Printify photos.",
    staleColors: [] as string[],
    invalidColors: [] as string[],
  })
  try {
    const parsed = galleryManifestSchema.safeParse(input.active)
    if (!parsed.success) return invalid()
    const manifest = parsed.data
    const source = readGallerySource(snapshot, input.revision)
    const historicalSources = new Map<string, ReturnType<typeof readGallerySource>>()
    const curatedIds = new Set(
      source.colors.filter((c) => manifest.colors.some((p) => p.colorKey === c.key)).flatMap((c) => c.variantIds)
    )
    const images: {
      src: string
      variant_ids: number[]
      is_default: boolean
      alt?: string
      view_key?: string
      origin?: "store"
    }[] = [...source.images]
      .sort((a, b) => Number(b.is_default) - Number(a.is_default))
      .flatMap((image) => {
        const ids = image.variant_ids.filter((id) => !curatedIds.has(id) && source.enabledIds.includes(id))
        return ids.length ? [{ ...image, variant_ids: ids }] : []
      })
    const withheld: number[] = [],
      staleColors: string[] = [],
      invalidColors: string[] = []
    for (const color of manifest.colors) {
      const current = source.colors.find((c) => c.key === color.colorKey)
      // Keep the selection dormant through stock gaps; recheck its binding when variants return.
      if (!current?.variantIds.length) continue
      if (
        !isGalleryBindingCurrent(
          color.reviewedBinding,
          current.binding,
          color.colorKey,
          input.history,
          historicalSources
        )
      ) {
        staleColors.push(color.colorKey)
        withheld.push(...current.variantIds)
        continue
      }
      if (
        color.entries.some((entry) => {
          const src = entry.source === "store" ? entry.publicUrl : entry.src
          return !src || !readGalleryImageLocation(src, input.blobHost, entry.source)
        })
      ) {
        invalidColors.push(color.colorKey)
        withheld.push(...current.variantIds)
        continue
      }
      for (const entry of color.entries) {
        const src = entry.source === "store" ? entry.publicUrl : entry.src
        if (!src) continue
        images.push({
          src,
          variant_ids: current.variantIds,
          is_default: false,
          alt: entry.alt,
          ...(entry.viewKey ? { view_key: entry.viewKey } : {}),
          ...(entry.source === "store" ? { origin: "store" as const } : {}),
        })
      }
    }
    const previousDefault = source.images.find((i) => i.is_default) ?? source.images[0]
    const previousColor = source.colors.find((c) =>
      previousDefault?.variant_ids.some((id) => c.variantIds.includes(id))
    )
    const cover = [manifest.coverColor, previousColor?.key, ...source.colors.map((c) => c.key)]
      .map((key) => {
        const color = source.colors.find((c) => c.key === key)
        if (!color) return undefined
        const matches = images.filter((i) => i.variant_ids.some((id) => color.variantIds.includes(id)))
        return matches.find((i) => i.is_default) ?? matches[0]
      })
      .find(Boolean)
    return {
      snapshot: {
        ...snapshot,
        images: images.map((i) => ({ ...i, is_default: i === cover })),
      },
      withheldVariantIds: withheld,
      diagnostic: invalidColors.length
        ? "Some curated colors have unavailable photos. Check image storage and review those colors."
        : null,
      staleColors,
      invalidColors,
    }
  } catch {
    return invalid()
  }
}
