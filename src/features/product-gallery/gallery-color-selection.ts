import type { GalleryColor } from "./gallery-manifest-schema"
import type { GalleryMutation } from "./gallery-mutation-schema"

type Selection = Extract<GalleryMutation, { action: "save" }>["manifest"]["colors"][number]

/** Compare editable choices without trusting client-supplied provenance or approval. */
export function galleryColorSelection(color: GalleryColor | Selection | null | undefined) {
  return color
    ? {
        colorKey: color.colorKey,
        entries: color.entries.map((entry) => ({
          source: entry.source,
          ...(entry.source === "store" ? { assetId: entry.assetId } : { src: entry.src }),
          alt: entry.alt,
          role: entry.role,
          ...(entry.viewKey ? { viewKey: entry.viewKey } : {}),
        })),
      }
    : null
}
