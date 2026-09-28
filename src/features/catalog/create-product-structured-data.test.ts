import "../../../test/configured-store"
import { storeConfig } from "@/lib/store-config"
import { describe, expect, it } from "vitest"

import type { CatalogProduct } from "./catalog-product"
import { createProductStructuredData } from "./create-product-structured-data"
import { normalizeCatalogProduct } from "./normalize-catalog-product"

const siteUrl = new URL("https://example.com")
const policyReferences = {
  hasMerchantReturnPolicy: { "@id": "https://example.com/returns#return-policy" },
  shippingDetails: {
    "@type": "OfferShippingDetails",
    hasShippingService: { "@id": "https://example.com/shipping#standard-shipping" },
  },
}

function productFixture(): CatalogProduct {
  return normalizeCatalogProduct({
    id: "climb-shirt",
    shop_id: 123,
    title: "Small Wins — Fixture Store | Next Level 6210",
    description: "A little progress counts.",
    variants: [
      { id: 1, price: 2500, is_enabled: true, is_available: true, options: [10, 20] },
      { id: 2, price: 2850, is_enabled: true, is_available: false, options: [10, 21] },
      { id: 3, price: 2795, is_enabled: true, is_available: true, options: [11, 21] },
      { id: 4, price: 1000, is_enabled: false, is_available: true, options: [11, 20] },
    ],
    options: [
      {
        name: "Color",
        type: "color",
        values: [
          { id: 10, title: "Black" },
          { id: 11, title: "Heather Grey" },
        ],
      },
      {
        name: "Size",
        type: "size",
        values: [
          { id: 20, title: "S" },
          { id: 21, title: "2XL" },
        ],
      },
    ],
    images: [
      { src: "https://images.printify.com/black-front.jpg", variant_ids: [1], is_default: true },
      { src: "https://images.printify.com/black-back.jpg", variant_ids: [1] },
      { src: "https://images.printify.com/grey-front.jpg", variant_ids: [3] },
    ],
  })
}

function productGroup(product: CatalogProduct) {
  return createProductStructuredData(product, siteUrl)["@graph"].find((item) => item["@type"] === "ProductGroup")
}

describe("createProductStructuredData", () => {
  it("describes enabled variants using exact selectable URLs, prices, availability, and matching color photos", () => {
    const group = productGroup(productFixture())

    expect(group).toMatchObject({
      "@type": "ProductGroup",
      "@id": "https://example.com/shop/climb-shirt#product",
      url: "https://example.com/shop/climb-shirt",
      name: "Small Wins",
      description: "A little progress counts.",
      productGroupID: "climb-shirt",
      brand: { "@type": "Brand", name: "Fixture Store" },
      variesBy: ["https://schema.org/color", "https://schema.org/size"],
    })
    expect(group?.hasVariant).toHaveLength(3)
    expect(
      group?.hasVariant.map((variant) => ({
        sku: variant.sku,
        color: variant.color,
        size: variant.size,
        images: variant.image,
        offer: variant.offers,
      }))
    ).toEqual([
      {
        sku: "climb-shirt-1",
        color: "Black",
        size: "S",
        images: ["https://images.printify.com/black-front.jpg", "https://images.printify.com/black-back.jpg"],
        offer: {
          "@type": "Offer",
          url: "https://example.com/shop/climb-shirt?color=Black&size=S",
          price: "25.00",
          priceCurrency: "USD",
          availability: "https://schema.org/InStock",
          itemCondition: "https://schema.org/NewCondition",
          ...policyReferences,
        },
      },
      {
        sku: "climb-shirt-2",
        color: "Black",
        size: "2XL",
        images: ["https://images.printify.com/black-front.jpg", "https://images.printify.com/black-back.jpg"],
        offer: {
          "@type": "Offer",
          url: "https://example.com/shop/climb-shirt?color=Black&size=2XL",
          price: "28.50",
          priceCurrency: "USD",
          availability: "https://schema.org/OutOfStock",
          itemCondition: "https://schema.org/NewCondition",
          ...policyReferences,
        },
      },
      {
        sku: "climb-shirt-3",
        color: "Heather Grey",
        size: "2XL",
        images: ["https://images.printify.com/grey-front.jpg"],
        offer: {
          "@type": "Offer",
          url: "https://example.com/shop/climb-shirt?color=Heather+Grey&size=2XL",
          price: "27.95",
          priceCurrency: "USD",
          availability: "https://schema.org/InStock",
          itemCondition: "https://schema.org/NewCondition",
          ...policyReferences,
        },
      },
    ])
    expect(group?.hasVariant.every((variant) => variant.url === variant.offers.url)).toBe(true)
    expect(new Set(group?.hasVariant.map((variant) => variant["@id"])).size).toBe(3)
    expect(JSON.stringify(group)).not.toMatch(/gtin|mpn|aggregateRating|reviewCount|priceValidUntil/)
  })

  it("retains sold-out offers even when there is no available aggregate price", () => {
    const product = productFixture()
    product.variants = product.variants.map((variant) => ({ ...variant, available: false }))
    product.price = null
    product.availability = "unavailable"

    const group = productGroup(product)
    expect(group?.hasVariant).toHaveLength(3)
    expect(group?.hasVariant.every((variant) => variant.offers.availability === "https://schema.org/OutOfStock")).toBe(
      true
    )
    expect(group?.hasVariant.map((variant) => variant.offers.price)).toEqual(["25.00", "28.50", "27.95"])
    for (const variant of group!.hasVariant) expect(variant.offers).toMatchObject(policyReferences)
  })

  it("resolves shared policy references against the site URL without inventing per-offer policy terms", () => {
    const data = createProductStructuredData(productFixture(), new URL("https://store.example/"))
    const group = data["@graph"].find((item) => item["@type"] === "ProductGroup")

    for (const variant of group!.hasVariant) {
      expect(variant.offers.hasMerchantReturnPolicy).toEqual({ "@id": "https://store.example/returns#return-policy" })
      expect(variant.offers.shippingDetails).toEqual({
        "@type": "OfferShippingDetails",
        hasShippingService: { "@id": "https://store.example/shipping#standard-shipping" },
      })
    }
    expect(JSON.stringify(data)).not.toMatch(/deliveryTime|handlingTime|transitTime|merchantReturnDays|returnFees/)
  })

  it("omits variants without color photos instead of borrowing a different color's default image or artwork", () => {
    const product = productFixture()
    product.images = product.images.filter((image) => !image.variantIds.includes(3))
    product.artwork = { src: "/artwork.png", alt: "Artwork", backgroundColor: null }

    expect(productGroup(product)?.hasVariant.map((variant) => variant.sku)).toEqual(["climb-shirt-1", "climb-shirt-2"])
    product.images = []
    expect(productGroup(product)).toBeUndefined()
  })

  it("omits incomplete and ambiguous options that cannot be selected by a distinct color/size URL", () => {
    const product = productFixture()
    product.variants[0]!.color = null
    product.variants[1]!.size = null
    expect(productGroup(product)?.hasVariant.map((variant) => variant.sku)).toEqual(["climb-shirt-3"])

    product.variants.push({ ...product.variants[2]!, id: 5 })
    expect(productGroup(product)).toBeUndefined()
  })

  it("omits color values that the product's color control cannot recognize", () => {
    const product = productFixture()
    product.colors = product.colors.filter((color) => color.name === "Black")
    expect(productGroup(product)?.hasVariant.map((variant) => variant.sku)).toEqual(["climb-shirt-1", "climb-shirt-2"])
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5])("does not publish an invalid price (%s)", (price) => {
    const product = productFixture()
    product.variants[0]!.price = price
    expect(productGroup(product)?.hasVariant.map((variant) => variant.sku)).toEqual(["climb-shirt-2", "climb-shirt-3"])
  })

  it("uses safe absolute image URLs and discards unsafe sources", () => {
    const product = productFixture()
    product.images = [
      { src: "/photos/black.jpg", alt: "Black tee", variantIds: [1] },
      { src: "javascript:alert(1)", alt: "Invalid", variantIds: [1] },
      { src: "data:image/png;base64,a", alt: "Invalid", variantIds: [1] },
      { src: "https://user:password@example.com/photo.jpg", alt: "Invalid", variantIds: [1] },
      { src: "http://example.com/photo.jpg", alt: "Invalid", variantIds: [1] },
    ]
    expect(productGroup(product)?.hasVariant[0]?.image).toEqual(["https://example.com/photos/black.jpg"])
  })

  it("encodes product and option values without changing the canonical URL or adding query parameters", () => {
    const product = productFixture()
    product.id = "shirt?color=Other#fragment"
    product.colors[0]!.name = "Black & White"
    product.variants[0]!.color = "Black & White"
    product.variants[0]!.size = "S/M + Tall"

    const variant = productGroup(product)?.hasVariant[0]
    const url = new URL(variant!.url)
    expect(url.pathname).toBe("/shop/shirt%3Fcolor%3DOther%23fragment")
    expect([...url.searchParams.entries()]).toEqual([
      ["color", "Black & White"],
      ["size", "S/M + Tall"],
    ])
    expect(url.hash).toBe("")
    expect(productGroup(product)?.url).toBe("https://example.com/shop/shirt%3Fcolor%3DOther%23fragment")
  })

  it("keeps breadcrumbs when product data is incomplete and avoids invented descriptions", () => {
    const product = productFixture()
    product.description = " "
    expect(productGroup(product)).not.toHaveProperty("description")
    expect(productGroup(product)?.hasVariant[0]).not.toHaveProperty("description")
    product.variants = []

    expect(createProductStructuredData(product, siteUrl)).toEqual({
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "BreadcrumbList",
          "@id": "https://example.com/shop/climb-shirt#breadcrumbs",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: "https://example.com/" },
            { "@type": "ListItem", position: 2, name: "Shop", item: "https://example.com/shop" },
            { "@type": "ListItem", position: 3, name: "Small Wins", item: "https://example.com/shop/climb-shirt" },
          ],
        },
      ],
    })
  })
})

it("omits unconfirmed shipping policy references from product offers", () => {
  storeConfig.commerce.shippingConfirmed = false
  const variants = productGroup(productFixture())?.hasVariant ?? []
  expect(variants.length).toBeGreaterThan(0)
  for (const variant of variants) {
    expect(variant.offers).not.toHaveProperty("shippingDetails")
    expect(variant.offers).toHaveProperty("hasMerchantReturnPolicy")
  }
})
