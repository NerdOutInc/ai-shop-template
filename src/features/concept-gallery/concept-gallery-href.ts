import type { ConceptGalleryFilters } from "./concept-gallery-types"

export function conceptGalleryHref(filters: ConceptGalleryFilters, page = 1) {
  const query = new URLSearchParams()
  if (filters.search) query.set("search", filters.search)
  if (filters.collectionId) query.set("collection", filters.collectionId)
  if (filters.family) query.set("family", filters.family)
  if (filters.productModelId) query.set("model", filters.productModelId)
  if (filters.status) query.set("status", filters.status)
  if (filters.designState && filters.designState !== "active") query.set("state", filters.designState)
  if (filters.favoritesOnly) query.set("favorites", "1")
  if (page > 1) query.set("page", String(page))
  return `/admin/concepts${query.size ? `?${query.toString()}` : ""}`
}
