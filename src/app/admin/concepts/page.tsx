import type { Metadata } from "next"

import { requireAdmin } from "@/features/admin/require-admin.server"
import { ConceptGallery } from "@/features/concept-gallery/concept-gallery"
import type { ConceptGalleryFilters } from "@/features/concept-gallery/concept-gallery-types"
import { createPostgresLibraryStore } from "@/features/design-library/postgres-library-store.server"

export const metadata: Metadata = { title: "Design library", robots: { index: false, follow: false } }
export const dynamic = "force-dynamic"

type SearchParams = Record<string, string | string[] | undefined>

function stringParam(params: SearchParams, key: string) {
  const value = params[key]
  return typeof value === "string" && value.length <= 250 ? value.trim() || undefined : undefined
}

export default async function ConceptsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { userId } = await requireAdmin()
  const params = await searchParams
  const rawStatus = stringParam(params, "status")
  const status =
    rawStatus === "no-product" ||
    rawStatus === "draft" ||
    rawStatus === "published" ||
    rawStatus === "needs-artwork" ||
    rawStatus === "unverified"
      ? rawStatus
      : undefined
  const rawState = stringParam(params, "state")
  const designState = rawState === "archived" || rawState === "rejected" ? rawState : "active"
  const filters: ConceptGalleryFilters = {
    designState,
    search: stringParam(params, "search"),
    collectionId: stringParam(params, "collection"),
    family: stringParam(params, "family"),
    productModelId: stringParam(params, "model"),
    status,
    favoritesOnly: stringParam(params, "favorites") === "1",
  }
  const requestedPage = Number(stringParam(params, "page") ?? "1")
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 && requestedPage <= 100000 ? requestedPage : 1
  const pageSize = 48
  const store = createPostgresLibraryStore()
  const [result, collections, options] = await Promise.all([
    store.listDesigns(userId, { ...filters, limit: pageSize, offset: (page - 1) * pageSize }),
    store.listCollections(userId),
    store.listFilterOptions(userId),
  ])

  return (
    <ConceptGallery
      key={JSON.stringify(filters)}
      designs={result.designs}
      total={result.total}
      collections={collections}
      filters={filters}
      options={options}
      page={page}
      pageSize={pageSize}
    />
  )
}
