import { expect, it } from "vitest"

import { normalizeCatalogProduct } from "@/features/catalog/normalize-catalog-product"
import { galleryProductFixture } from "../../../test/gallery-product-fixture"

import { createAgentCatalog } from "./create-agent-catalog"

const siteUrl = new URL("https://store.example")
const image = galleryProductFixture().images[0]!.src

it("describes the store and every listable variant with decimal prices and canonical URLs", () => {
  const raw = galleryProductFixture()
  raw.title = "Fixture tee – Fixture Store"
  raw.variants[1]!.is_available = false
  const product = normalizeCatalogProduct(raw)
  expect(createAgentCatalog([{ product, category: "T-shirts" }], siteUrl)).toEqual({
    store: {
      name: "Fixture Store",
      description: "Original shirts for good company and the weekend ahead.",
      url: "https://store.example/",
      currency: "USD",
      shippingPolicyUrl: "https://store.example/shipping",
      returnPolicyUrl: "https://store.example/returns",
      privacyUrl: "https://store.example/privacy",
    },
    products: [
      {
        id: "shirt",
        url: "https://store.example/shop/shirt",
        title: "Fixture tee",
        description: "A cotton T-shirt.",
        brand: "Fixture Store",
        category: "T-shirts",
        images: [image],
        priceRange: { min: "33.00", max: "33.00", currency: "USD" },
        colors: ["Black", "Navy"],
        sizes: ["M"],
        variants: [
          {
            id: 101,
            sku: "shirt-101",
            color: "Black",
            size: "M",
            price: "33.00",
            currency: "USD",
            available: true,
            url: "https://store.example/shop/shirt?color=Black&size=M",
            images: [image],
          },
          {
            id: 201,
            sku: "shirt-201",
            color: "Navy",
            size: "M",
            price: "33.00",
            currency: "USD",
            available: false,
            url: "https://store.example/shop/shirt?color=Navy&size=M",
            images: [image],
          },
        ],
      },
    ],
  })
})

it("reports no price range for a sold-out product and keeps provider color names out of labels", () => {
  const raw = galleryProductFixture()
  raw.options[0]!.values[0]!.title = "CVC Black"
  for (const variant of raw.variants) variant.is_available = false
  const [product] = createAgentCatalog([{ product: normalizeCatalogProduct(raw), category: null }], siteUrl).products
  expect(product?.priceRange).toBeNull()
  expect(product?.category).toBeNull()
  expect(product?.colors).toEqual(["Black", "Navy"])
  expect(product?.variants[0]).toMatchObject({
    color: "Black",
    url: "https://store.example/shop/shirt?color=CVC+Black&size=M",
  })
})

it("keeps the gallery's cover photo first even when it belongs to a later variant's color", () => {
  const raw = galleryProductFixture()
  const navy = `https://galleryfixtures.public.blob.vercel-storage.com/published-mockups/v1/${"b".repeat(64)}.jpg`
  raw.images = [
    { src: image, variant_ids: [101], is_default: false },
    { src: navy, variant_ids: [201], is_default: true },
  ]
  const product = normalizeCatalogProduct(raw)
  expect(product.image?.src).toBe(navy)
  const [listed] = createAgentCatalog([{ product, category: null }], siteUrl).products
  expect(listed?.images).toEqual([navy, image])
  expect(listed?.variants.map((variant) => variant.images)).toEqual([[image], [navy]])
})

it("leaves out a product whose variants cannot be preselected from a product page", () => {
  const raw = galleryProductFixture()
  raw.options.pop()
  expect(createAgentCatalog([{ product: normalizeCatalogProduct(raw), category: null }], siteUrl).products).toEqual([])
})
