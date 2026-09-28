import type { LibraryCollection, LibraryDesign, LibraryDesignFilter } from "@/features/design-library/library-types"

export type ConceptGalleryFilters = Pick<
  LibraryDesignFilter,
  "search" | "collectionId" | "family" | "productModelId" | "status" | "favoritesOnly" | "designState"
>

export type ConceptGalleryProps = {
  designs: LibraryDesign[]
  total: number
  collections: LibraryCollection[]
  filters: ConceptGalleryFilters
  options: { families: string[]; productModels: { id: string; label: string }[] }
  page: number
  pageSize: number
}
