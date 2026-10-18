import "server-only"
import { normalizeCatalogProduct } from "@/features/catalog/normalize-catalog-product"
import { env } from "@/lib/env"
import { getProductGalleryStore } from "./get-product-gallery-store.server"
import { galleryManifestSchema } from "./gallery-manifest-schema"
import { readGallerySource } from "./read-gallery-source.server"
import { isGalleryBindingCurrent } from "./is-gallery-binding-current.server"
import { readGalleryImageLocation } from "./read-gallery-image-location"
import { resolveProductGallery } from "./resolve-product-gallery.server"

export async function readGalleryEditor(product: string) {
  const store = getProductGalleryStore(),
    state = await store.read(product)
  const [assets, history, evidence] = await Promise.all([
    store.assets(product),
    store.history(product),
    store.evidence(product, [state.draft, state.published]),
  ])
  const draft = galleryManifestSchema.safeParse(state.draft),
    active = galleryManifestSchema.safeParse(state.published)
  const source = readGallerySource(state.snapshot, state.productRevision)
  const historicalSources = new Map<string, ReturnType<typeof readGallerySource>>()
  const resolution = resolveProductGallery({
    snapshot: state.snapshot,
    active: state.published,
    revision: state.productRevision,
    history: evidence,
    blobHost: env.NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST,
  })
  const display = normalizeCatalogProduct(state.snapshot)
  const currentColors = source.colors.map((color) => ({ ...color, available: color.variantIds.length > 0 }))
  const missingKeys = [
    ...new Set(
      [...(draft.success ? draft.data.colors : []), ...(active.success ? active.data.colors : [])].map(
        (c) => c.colorKey
      )
    ),
  ].filter((key) => !currentColors.some((c) => c.key === key))
  const colors = [
    ...currentColors,
    ...missingKeys.map((key) => ({
      key,
      title: `Removed color ${key}`,
      variantIds: [] as number[],
      binding: null,
      available: false,
    })),
  ]
  return {
    productId: product,
    title: source.title,
    revision: state.revision,
    productRevision: state.productRevision,
    active: state.active,
    draft: draft.success ? draft.data : store.emptyManifest(),
    diagnostic:
      resolution.diagnostic ??
      (state.draft && !draft.success
        ? "The saved draft cannot be read. Restore a saved revision before activation."
        : null),
    assets: assets.map(({ id, width, height }) => ({ id, width, height })),
    history,
    artwork: display.artwork ?? null,
    colors: colors.map((color) => {
      const saved = draft.success ? draft.data.colors.find((c) => c.colorKey === color.key) : undefined
      const current = active.success ? active.data.colors.find((c) => c.colorKey === color.key) : undefined
      return {
        ...color,
        recoverySelection: color.available ? null : (current ?? null),
        hex: display.colors.find((c) => c.name === color.title)?.hex ?? null,
        draftCurrent: saved
          ? isGalleryBindingCurrent(saved.reviewedBinding, color.binding, color.key, evidence, historicalSources)
          : false,
        activeMode: current
          ? current.entries.some((e) => e.source === "provider")
            ? "Mixed"
            : "Store photos only"
          : "Printify",
        activeStale: resolution.staleColors.includes(color.key),
        activeInvalid: resolution.invalidColors.includes(color.key),
        providerImages: source.images
          .filter((i) => i.variant_ids.some((id) => color.variantIds.includes(id)))
          .map((i) => ({
            src: i.src,
            alt: source.title.slice(0, 300),
            viewKey: i.view_key,
            selectable: readGalleryImageLocation(i.src, env.NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST, "provider") !== null,
          })),
      }
    }),
  }
}
export type GalleryEditorData = Awaited<ReturnType<typeof readGalleryEditor>>
