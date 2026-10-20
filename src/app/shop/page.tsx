import type { Metadata } from "next"
import { connection } from "next/server"

import { getSiteUrl } from "@/lib/get-site-url"
import { storeConfig } from "@/lib/store-config"

import { getCatalog } from "@/features/catalog/get-catalog.server"
import { ProductList } from "@/features/catalog/product-list"

import { ShopStructuredData } from "./_components/shop-structured-data"

export const metadata: Metadata = {
  alternates: { canonical: "/shop" },
  title: "Shop",
  description: storeConfig.description,
}

export default async function ShopPage() {
  await connection()
  const catalog = await getCatalog()
  return (
    <main id="main-content" tabIndex={-1} className="page-width shop-page">
      <h1 className="display-heading">Shop the collection</h1>
      <p className="shop-description">{storeConfig.tagline}</p>
      <ShopStructuredData products={catalog.products} siteUrl={getSiteUrl()} />
      <ProductList catalog={catalog} />
    </main>
  )
}
