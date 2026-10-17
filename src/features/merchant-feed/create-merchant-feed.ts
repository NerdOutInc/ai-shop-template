import { storeConfig } from "@/lib/store-config"
import { displayProductTitle } from "@/features/catalog/display-product-title"
import { displayProductVariantTitle } from "@/features/catalog/display-product-variant-title"
import { getProductVariantListings } from "@/features/catalog/get-product-variant-listings"
import { garmentFeedProfileSchema } from "@/features/garment-catalog/garment-feed-profile-schema"

import { merchantField } from "./merchant-field"
import { escapeMerchantXml } from "./escape-merchant-xml"
import { MerchantFeedError } from "./merchant-feed-error"
import type { MerchantProduct } from "./merchant-product"

function imageField(name: string, value: string) {
  const extension = new URL(value).pathname.match(/\.([^./]+)$/)?.[1]?.toLowerCase()
  // Dynamic provider image URLs may have no suffix; reject explicitly unsupported file formats.
  if (extension && !["jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff"].includes(extension)) {
    throw new MerchantFeedError("INVALID_IMAGE_FORMAT")
  }
  return merchantField(name, value, 2000)
}

function feedDescription(product: MerchantProduct["product"]) {
  const guide = product.sizeGuide
  if (product.description !== "" || !guide?.sizes.length || !guide.measurements.length) return product.description
  // Table-only provider copy has no storefront prose. Keep its facts in the feed without changing the page's intro.
  return [
    product.title,
    "Size guide",
    ...guide.measurements.map(
      (row) => `${row.label}: ${row.values.map((value, index) => `${guide.sizes[index]}: ${value}`).join("; ")}`
    ),
  ].join("\n")
}

export function createMerchantFeed(
  products: readonly MerchantProduct[],
  siteUrl: URL,
  destination: "google" | "meta" = "google"
): string {
  if (siteUrl.protocol !== "https:" || siteUrl.username || siteUrl.password) {
    throw new MerchantFeedError("INVALID_ORIGIN")
  }
  const productIds = new Set<string>()
  const itemIds = new Set<string>()
  const items = products.flatMap(({ product, apparel, googleCopy }) => {
    try {
      if (productIds.has(product.id.toLowerCase()) || product.id !== product.id.trim()) {
        throw new MerchantFeedError("INVALID_PRODUCT_ID")
      }
      productIds.add(product.id.toLowerCase())
      const canonicalPath = `/shop/${encodeURIComponent(product.id)}`
      const canonicalUrl = new URL(canonicalPath, siteUrl)
      if (canonicalUrl.pathname !== canonicalPath) throw new MerchantFeedError("INVALID_PRODUCT_ID")
      const listings = getProductVariantListings(product, siteUrl)
      if (listings.length !== product.variants.length) throw new MerchantFeedError("INCOMPLETE_VARIANTS")
      if (!garmentFeedProfileSchema.safeParse(apparel).success) {
        throw new MerchantFeedError("UNSUPPORTED_APPAREL")
      }
      const title = displayProductTitle(product.title)
      const description = feedDescription(product)
      return listings.map((variant) => {
        const id = `${product.id}-${variant.id}`
        if (itemIds.has(id.toLowerCase()) || typeof variant.available !== "boolean") {
          throw new MerchantFeedError("INVALID_VARIANT_ID")
        }
        if (variant.price <= 0) throw new MerchantFeedError("INVALID_PRICE")
        itemIds.add(id.toLowerCase())
        const copy = destination === "google" ? googleCopy?.get(variant.id) : undefined
        return [
          "<item>",
          merchantField("id", id, 50),
          merchantField("item_group_id", product.id, 50),
          merchantField("item_group_title", title, 150),
          ...(["color", "size"] as const).map(
            (attribute) =>
              `<g:variant_option>${merchantField("name", attribute, 250)}${merchantField("value", variant[attribute], 250)}</g:variant_option>`
          ),
          merchantField("title", displayProductVariantTitle(product.title, variant), 150),
          ...(copy?.origin === "generated"
            ? [
                `<g:structured_description>${merchantField("digital_source_type", "trained_algorithmic_media", 50)}${merchantField("content", copy.content, 5000)}</g:structured_description>`,
              ]
            : [merchantField("description", copy?.content ?? description, 5000)]),
          ...(copy?.pattern ? [merchantField("pattern", copy.pattern, 100)] : []),
          ...(copy?.material ? [merchantField("material", copy.material, 200)] : []),
          merchantField("link", variant.url, 2000),
          merchantField("canonical_link", canonicalUrl.href, 2000),
          imageField("image_link", variant.images[0]!),
          ...variant.images.slice(1, 11).map((image) => imageField("additional_image_link", image)),
          merchantField(
            "price",
            `${Math.floor(variant.price / 100)}.${String(variant.price % 100).padStart(2, "0")} USD`,
            50
          ),
          merchantField("availability", variant.available ? "in_stock" : "out_of_stock", 20),
          // Our made-to-order quantity convention; real Meta import acceptance is a separate deployment check.
          ...(destination === "meta"
            ? [merchantField("quantity_to_sell_on_facebook", variant.available ? "999999" : "0", 6)]
            : []),
          merchantField("condition", "new", 20),
          merchantField("brand", storeConfig.name, 70),
          merchantField("google_product_category", String(apparel.googleProductCategory), 10),
          merchantField("age_group", apparel.ageGroup, 20),
          merchantField("gender", apparel.gender, 20),
          merchantField("size_system", apparel.sizeSystem, 20),
          merchantField("color", variant.color, 100),
          merchantField("size", variant.size, 100),
          "</item>",
        ].join("")
      })
    } catch (error) {
      throw new MerchantFeedError(error instanceof MerchantFeedError ? error.code : "UNKNOWN_ERROR", product.id)
    }
  })

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0"><channel>',
    `<title>${escapeMerchantXml(storeConfig.name)}</title>`,
    `<link>${escapeMerchantXml(new URL("/", siteUrl).href)}</link>`,
    `<description>${escapeMerchantXml(storeConfig.name)} product catalog</description>`,
    ...items,
    "</channel></rss>",
  ].join("\n")
}
