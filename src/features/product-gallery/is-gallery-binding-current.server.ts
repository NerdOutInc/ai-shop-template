import "server-only"
import type { GalleryBinding } from "./gallery-manifest-schema"
import { readGallerySource } from "./read-gallery-source.server"

export function isGalleryBindingCurrent(
  binding: GalleryBinding | null,
  current: GalleryBinding | null,
  colorKey: string,
  history: Record<string, Record<string, unknown>> = {},
  sources = new Map<string, ReturnType<typeof readGallerySource>>()
) {
  if (!binding || !current) return false
  if (binding.version === current.version) return binding.digest === current.digest
  const snapshot = history[binding.sourceRevision]
  if (!snapshot) return false
  try {
    let source = sources.get(binding.sourceRevision)
    if (!source) {
      source = readGallerySource(snapshot, binding.sourceRevision)
      sources.set(binding.sourceRevision, source)
    }
    const previous = source.colors.find((c) => c.key === colorKey)?.binding
    return previous?.digest === current.digest
  } catch {
    return false
  }
}
