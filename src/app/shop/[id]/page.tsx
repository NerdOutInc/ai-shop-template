import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { connection } from "next/server"

import { buildProductMetadata } from "@/features/catalog/build-product-metadata"
import { getCatalogProduct } from "@/features/catalog/get-catalog-product.server"
import { ProductDetails } from "@/features/catalog/product-details"
import { ProductStructuredData } from "@/features/catalog/product-structured-data"
import { getSiteUrl } from "@/lib/get-site-url"

type ProductPageProps = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { id } = await params
  const result = await getCatalogProduct(id)
  if (result.status === "missing") return { title: "Product not found" }
  if (result.status === "unavailable") return { title: "Product" }
  const { product } = result
  const metadata = buildProductMetadata(product)
  return {
    ...metadata,
    alternates: { canonical: `/shop/${encodeURIComponent(product.id)}` },
    openGraph: { ...metadata.openGraph, url: `/shop/${encodeURIComponent(product.id)}` },
  }
}

export default async function ProductPage({ params }: ProductPageProps) {
  await connection()
  const { id } = await params
  const result = await getCatalogProduct(id)
  if (result.status === "missing") notFound()
  const product = result.status === "ready" ? result.product : null
  const isNew = result.status === "ready" && result.isNew
  return (
    <main id="main-content" tabIndex={-1} className="page-width product-page">
      <Link href="/shop" className="mb-4 inline-flex min-h-11 items-center text-sm underline underline-offset-4">
        Back to shop
      </Link>
      {product ? (
        <>
          <ProductStructuredData product={product} siteUrl={getSiteUrl()} />
          <ProductDetails key={product.id} product={product} isNew={isNew} />
        </>
      ) : (
        <div className="py-16">
          <h1 className="display-heading">This product is taking a breather.</h1>
          <p className="mt-5" role="status">
            We couldn’t load the latest product details. Please refresh or come back soon.
          </p>
        </div>
      )}
    </main>
  )
}
