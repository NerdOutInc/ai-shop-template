import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { requireAdmin } from "@/features/admin/require-admin.server"
import { ConceptDetail } from "@/features/concept-gallery/concept-detail"
import { createPostgresLibraryStore } from "@/features/design-library/postgres-library-store.server"

export const metadata: Metadata = { title: "Design details", robots: { index: false, follow: false } }
export const dynamic = "force-dynamic"

export default async function ConceptPage({
  params,
  searchParams,
}: {
  params: Promise<{ number: string }>
  searchParams: Promise<{ revision?: string | string[] }>
}) {
  const { userId } = await requireAdmin()
  const { number } = await params
  if (!/^[1-9]\d*$/.test(number) || !Number.isSafeInteger(Number(number))) notFound()
  const query = await searchParams
  const revisionId = typeof query.revision === "string" ? query.revision : undefined
  const store = createPostgresLibraryStore()
  const [design, collections] = await Promise.all([
    store.getDesign(userId, Number(number)),
    store.listCollections(userId),
  ])
  if (!design || (revisionId && !design.revisions.some((revision) => revision.id === revisionId))) notFound()

  return (
    <ConceptDetail
      key={`${design.id}:${revisionId ?? design.favoriteRevisionId}`}
      design={design}
      collections={collections}
      revisionId={revisionId}
    />
  )
}
