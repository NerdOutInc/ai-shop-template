import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { connection } from "next/server"

import { getAdminCatalogProduct } from "@/features/catalog/get-admin-catalog-product.server"
import { ProductDetails } from "@/features/catalog/product-details"

import { GoogleMerchantCopyEditor } from "./_components/google-merchant-copy-editor"

export const metadata: Metadata = {
  title: "Product preview",
  robots: { index: false, follow: false },
}

export default async function AdminProductPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  await connection()
  const { id } = await params
  const result = await getAdminCatalogProduct(id)
  if (result.status === "missing") notFound()

  return (
    <main id="main-content" tabIndex={-1} className="page-width product-page">
      <Link
        href="/admin/products"
        className="mb-4 inline-flex min-h-11 items-center text-sm underline underline-offset-4"
      >
        Back to shop lineup
      </Link>
      <aside aria-label="Admin preview" className="mb-8 rounded-lg border border-border bg-muted/50 px-5 py-4">
        <p className="font-condensed text-lg font-semibold uppercase">Admin preview</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Only admins can see this page. Previewing keeps this tee’s place in the shop lineup unchanged.
        </p>
      </aside>
      {result.status === "ready" ? (
        <>
          <ProductDetails key={result.product.id} product={result.product} preview />
          <GoogleMerchantCopyEditor key={`google-copy-${result.product.id}`} productId={result.product.id} />
        </>
      ) : (
        <div className="py-16">
          <h1 className="display-heading">This preview is taking a breather.</h1>
          <p className="mt-5" role="status">
            We couldn’t load the latest product details. Please refresh or come back soon.
          </p>
        </div>
      )}
    </main>
  )
}
