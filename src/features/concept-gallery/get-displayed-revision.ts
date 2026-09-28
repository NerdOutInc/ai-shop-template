import type { LibraryArtworkRevision, LibraryDesign } from "@/features/design-library/library-types"

export function getDisplayedRevision(design: LibraryDesign, revisionId?: string): LibraryArtworkRevision | null {
  const selectedId = revisionId ?? design.favoriteRevisionId
  // A missing saved revision must remain missing, rather than silently selecting newer artwork.
  return selectedId ? (design.revisions.find((revision) => revision.id === selectedId) ?? null) : design.revision
}
