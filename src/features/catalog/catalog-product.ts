import type { GarmentDisplayProfile } from "@/features/garment-catalog/garment-catalog"

export type CatalogVariant = {
  id: number
  title: string
  price: number
  currency: "USD"
  available: boolean
  color: string | null
  size: string | null
  options: { name: string; value: string }[]
}

export type CatalogSizeGuide = {
  sizes: string[]
  measurements: { label: string; values: string[] }[]
}

export type CatalogDescriptionInline = {
  text: string
  bold: boolean
  italic: boolean
}

export type CatalogDescriptionBlock =
  | { type: "paragraph" | "heading"; content: CatalogDescriptionInline[] }
  | { type: "list"; ordered: boolean; items: CatalogDescriptionBlock[][] }

export type CatalogProduct = {
  id: string
  title: string
  description: string
  descriptionBlocks?: CatalogDescriptionBlock[]
  /** Current saved garment identity; absent when a profile cannot be read or does not exist. */
  garment?: GarmentDisplayProfile | null
  /**
   * When the product most recently entered the shop: the owner's last Show in shop, or the scheduled
   * reveal that brought it back. Null when the storefront did not supply one, which is every read
   * outside the public shop (the admin preview and merchant feeds). Newest sorts by it; isNewProduct reads it.
   */
  addedToShopAt: string | null
  salesCount: number | null
  defaultColor?: string | null
  image: { src: string; alt: string; viewKey?: string } | null
  artwork?: { src: string; alt: string; backgroundColor: string | null } | null
  images: { src: string; alt: string; variantIds: number[]; viewKey?: string }[]
  price: { currency: "USD"; min: number; max: number } | null
  options: { name: string; values: string[] }[]
  variants: CatalogVariant[]
  colors: { name: string; hex: string | null }[]
  sizeGuide: CatalogSizeGuide | null
  availability: "available" | "unavailable"
}

export type CatalogResult = {
  status: "ready" | "empty" | "partial" | "unavailable"
  products: CatalogProduct[]
  popularityStatus?: "ready" | "unavailable"
  /**
   * The published products carrying this week's Design of the Week, resolved server-side.
   *
   * Catalog-wide rather than a flag on each product, so the drop stays out of the product detail
   * page, both merchant feeds, the cart and the sitemap — none of which have an opinion about it.
   * Absent means no drop; the ids are always a subset of `products`.
   */
  designOfTheWeekProductIds?: string[]
  /**
   * The products that get a New badge, decided by isNewProduct against one clock reading taken when
   * the catalog was read, so a page never reads a clock while it renders. Absent means none; the ids
   * are always a subset of `products`.
   */
  newProductIds?: string[]
}

/** `isNew` travels beside the product for the same reason as CatalogResult.newProductIds. */
export type CatalogProductResult =
  { status: "ready"; product: CatalogProduct; isNew: boolean } | { status: "missing" } | { status: "unavailable" }
