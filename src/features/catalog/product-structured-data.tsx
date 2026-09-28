import { JsonLdScript } from "@/components/json-ld-script"

import type { CatalogProduct } from "./catalog-product"
import { createProductStructuredData } from "./create-product-structured-data"

export function ProductStructuredData({ product, siteUrl }: { product: CatalogProduct; siteUrl: URL }) {
  return <JsonLdScript data={createProductStructuredData(product, siteUrl)} />
}
