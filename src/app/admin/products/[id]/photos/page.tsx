import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { connection } from "next/server"

import { getAdminActor } from "@/features/admin/get-admin-actor.server"
import { GalleryError } from "@/features/product-gallery/gallery-error"
import { logGalleryFailure } from "@/features/product-gallery/log-gallery-failure.server"
import { readGalleryEditor } from "@/features/product-gallery/read-gallery-editor.server"

import { ProductPhotoEditor } from "./_components/product-photo-editor"

export const metadata: Metadata = { title: "Product photos", robots: { index: false, follow: false } }

export default async function ProductPhotosPage({ params }: { params: Promise<{ id: string }> }) {
  await connection()
  if (!(await getAdminActor())) notFound()
  const { id } = await params
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) notFound()
  let data
  try {
    data = await readGalleryEditor(id)
  } catch (error) {
    if (error instanceof GalleryError && error.status === 404) notFound()
    logGalleryFailure(error)
  }
  return (
    <main id="main-content" tabIndex={-1} className="page-width py-10">
      <Link
        href={`/admin/products/${encodeURIComponent(id)}`}
        className="mb-6 inline-flex min-h-11 items-center underline underline-offset-4"
      >
        Back to product preview
      </Link>
      {data ? (
        <ProductPhotoEditor initial={data} />
      ) : (
        <>
          <h1 className="display-heading">Product photos are unavailable</h1>
          <p role="alert" className="mt-5 max-w-2xl">
            Check the product gallery database migration and publishing configuration, then reload this page. Your saved
            selections remain in place.
          </p>
        </>
      )}
    </main>
  )
}
