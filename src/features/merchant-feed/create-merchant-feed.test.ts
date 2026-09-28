import { describe, expect, it } from "vitest"

import { createProductStructuredData } from "@/features/catalog/create-product-structured-data"
import { normalizeCatalogProduct } from "@/features/catalog/normalize-catalog-product"

import { createMerchantFeed } from "./create-merchant-feed"
import type { MerchantProduct } from "./merchant-product"

const siteUrl = new URL("https://example.com")
const namespace = "http://base.google.com/ns/1.0"

function fixture(): MerchantProduct {
  return {
    apparel: { googleProductCategory: 212, ageGroup: "adult", gender: "unisex", sizeSystem: "US" },
    product: normalizeCatalogProduct({
      id: "climb-shirt",
      shop_id: 123,
      title: "Small Wins — Your Store | Next Level 6210",
      description: "<p>A little progress counts.</p><p>Bring your friends.</p>",
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
    }),
  }
}

function items(xml: string) {
  const document = new DOMParser().parseFromString(xml, "application/xml")
  expect(document.querySelector("parsererror")).toBeNull()
  expect(document.documentElement.getAttribute("version")).toBe("2.0")
  return [...document.querySelectorAll("item")]
}

function values(item: Element, name: string) {
  return [...item.getElementsByTagNameNS(namespace, name)].map((element) => element.textContent)
}

function value(item: Element, name: string) {
  const result = values(item, name)
  expect(result).toHaveLength(1)
  return result[0]
}

describe("createMerchantFeed", () => {
  it.each(["google", "meta"] as const)("serializes configured apparel fields in the %s feed", (destination) => {
    const product = fixture()
    product.apparel = { googleProductCategory: 1604, gender: "female", ageGroup: "kids", sizeSystem: "EU" }
    const rows = items(createMerchantFeed([product], siteUrl, destination))
    for (const row of rows) {
      expect(value(row, "google_product_category")).toBe("1604")
      expect(value(row, "gender")).toBe("female")
      expect(value(row, "age_group")).toBe("kids")
      expect(value(row, "size_system")).toBe("EU")
    }
  })

  it.each([
    { googleProductCategory: null },
    { googleProductCategory: 0 },
    { googleProductCategory: 212.5 },
    { googleProductCategory: "212" },
    { gender: "unknown" },
    { gender: null },
    { ageGroup: "teen" },
    { sizeSystem: "unknown" },
  ])("rejects malformed apparel instead of falling back to T-shirt defaults: %j", (invalid) => {
    const product = fixture()
    Object.assign(product.apparel, invalid)
    expect(() => createMerchantFeed([product], siteUrl)).toThrow("unsupported apparel")
  })

  it("adds our made-to-order Meta quantity without changing the Google catalog", () => {
    const product = fixture()
    const google = createMerchantFeed([product], siteUrl)
    const meta = createMerchantFeed([product], siteUrl, "meta")
    const rows = items(meta)
    expect(rows.map((row) => ({ id: value(row, "id"), quantity: value(row, "quantity_to_sell_on_facebook") }))).toEqual(
      [
        { id: "climb-shirt-1", quantity: "999999" },
        { id: "climb-shirt-2", quantity: "0" },
        { id: "climb-shirt-3", quantity: "999999" },
      ]
    )
    expect(google).not.toContain("quantity_to_sell_on_facebook")
    expect(createMerchantFeed([product], siteUrl, "google")).toBe(google)
    expect(meta.replace(/<g:quantity_to_sell_on_facebook>\d+<\/g:quantity_to_sell_on_facebook>/g, "")).toBe(google)
  })

  it("restores Meta quantity for the same variant when it becomes available again", () => {
    const product = fixture()
    const variant = product.product.variants[0]!
    for (const available of [false, true]) {
      variant.available = available
      const row = items(createMerchantFeed([product], siteUrl, "meta"))[0]!
      expect(value(row, "id")).toBe("climb-shirt-1")
      expect(value(row, "availability")).toBe(available ? "in_stock" : "out_of_stock")
      expect(value(row, "quantity_to_sell_on_facebook")).toBe(available ? "999999" : "0")
    }
  })

  it("exports each enabled variant with the published price, selection, color photo, and availability", () => {
    const merchantProduct = fixture()
    const rows = items(createMerchantFeed([merchantProduct], siteUrl))
    expect(rows).toHaveLength(3)
    expect(
      rows.map((row) => ({
        id: value(row, "id"),
        group: value(row, "item_group_id"),
        link: value(row, "link"),
        image: value(row, "image_link"),
        price: value(row, "price"),
        availability: value(row, "availability"),
      }))
    ).toEqual([
      {
        id: "climb-shirt-1",
        group: "climb-shirt",
        link: "https://example.com/shop/climb-shirt?color=Black&size=S",
        image: "https://images.printify.com/black-front.jpg",
        price: "25.00 USD",
        availability: "in_stock",
      },
      {
        id: "climb-shirt-2",
        group: "climb-shirt",
        link: "https://example.com/shop/climb-shirt?color=Black&size=2XL",
        image: "https://images.printify.com/black-front.jpg",
        price: "28.50 USD",
        availability: "out_of_stock",
      },
      {
        id: "climb-shirt-3",
        group: "climb-shirt",
        link: "https://example.com/shop/climb-shirt?color=Heather+Grey&size=2XL",
        image: "https://images.printify.com/grey-front.jpg",
        price: "27.95 USD",
        availability: "in_stock",
      },
    ])
    expect(values(rows[0]!, "additional_image_link")).toEqual(["https://images.printify.com/black-back.jpg"])
    expect(value(rows[0]!, "title")).toBe("Small Wins – Black / S")
    expect(value(rows[0]!, "description")).toBe(merchantProduct.product.description)
    expect(value(rows[0]!, "canonical_link")).toBe("https://example.com/shop/climb-shirt")
    expect(value(rows[0]!, "brand")).toBe("Your Store")
    expect(value(rows[0]!, "google_product_category")).toBe("212")
    expect(value(rows[0]!, "condition")).toBe("new")
    expect(value(rows[0]!, "gender")).toBe("unisex")
    expect(value(rows[0]!, "age_group")).toBe("adult")
    expect(value(rows[0]!, "size_system")).toBe("US")
    expect(value(rows[0]!, "color")).toBe("Black")
    expect(value(rows[0]!, "size")).toBe("S")
    expect(value(rows[0]!, "item_group_title")).toBe("Small Wins")
    expect(
      [...rows[0]!.getElementsByTagNameNS(namespace, "variant_option")].map((option) => ({
        name: value(option, "name"),
        value: value(option, "value"),
      }))
    ).toEqual([
      { name: "color", value: "Black" },
      { name: "size", value: "S" },
    ])
    for (const name of ["gtin", "mpn", "identifier_exists", "adult", "shipping", "shipping_weight", "material"]) {
      expect(rows.every((row) => values(row, name).length === 0)).toBe(true)
    }
  })

  it("keeps feed URLs, images, prices, and IDs consistent with the page's structured data", () => {
    const merchantProduct = fixture()
    const rows = items(createMerchantFeed([merchantProduct], siteUrl))
    const group = createProductStructuredData(merchantProduct.product, siteUrl)["@graph"].find(
      (item) => item["@type"] === "ProductGroup"
    )!
    expect(
      rows.map((row) => ({
        id: value(row, "id"),
        link: value(row, "link"),
        image: value(row, "image_link"),
        price: value(row, "price"),
      }))
    ).toEqual(
      group.hasVariant.map((variant) => ({
        id: variant.sku,
        link: variant.url,
        image: variant.image[0],
        price: `${variant.offers.price} USD`,
      }))
    )
  })

  it("keeps IDs stable when order, title, price, and stock change", () => {
    const original = fixture()
    const changed = fixture()
    changed.product.title = "New title"
    changed.product.variants.reverse()
    changed.product.variants.forEach((variant) => {
      variant.price += 100
      variant.available = !variant.available
    })
    expect(
      items(createMerchantFeed([original], siteUrl))
        .map((row) => value(row, "id"))
        .sort()
    ).toEqual(
      items(createMerchantFeed([changed], siteUrl))
        .map((row) => value(row, "id"))
        .sort()
    )
  })

  it("retains sold-out variants even when the available aggregate price is absent", () => {
    const merchantProduct = fixture()
    merchantProduct.product.price = null
    merchantProduct.product.availability = "unavailable"
    merchantProduct.product.variants.forEach((variant) => {
      variant.available = false
    })
    const rows = items(createMerchantFeed([merchantProduct], siteUrl))
    expect(rows.map((row) => value(row, "availability"))).toEqual(["out_of_stock", "out_of_stock", "out_of_stock"])
    expect(rows.map((row) => value(row, "price"))).toEqual(["25.00 USD", "28.50 USD", "27.95 USD"])
  })

  it("allows an authoritative empty catalog and products with no enabled variants", () => {
    expect(items(createMerchantFeed([], siteUrl))).toHaveLength(0)
    const merchantProduct = fixture()
    merchantProduct.product.variants = []
    expect(items(createMerchantFeed([merchantProduct], siteUrl))).toHaveLength(0)
  })

  it("escapes XML delimiters without changing published copy, options, or URL query parameters", () => {
    const merchantProduct = fixture()
    merchantProduct.product.id = "shirt&one"
    merchantProduct.product.title = 'A < B & "friends"'
    merchantProduct.product.description = 'Keep <climbing> & "trying".\nIt’s us vs. the wall. 🧗 </description><item />'
    merchantProduct.product.colors[0]!.name = "Black & White"
    merchantProduct.product.variants.slice(0, 2).forEach((variant) => {
      variant.color = "Black & White"
    })
    merchantProduct.product.images[0]!.src = "https://images.printify.com/black.jpg?camera=front&size=large"
    const xml = createMerchantFeed([merchantProduct], siteUrl)
    const rows = items(xml)
    expect(rows).toHaveLength(3)
    expect(value(rows[0]!, "description")).toBe(merchantProduct.product.description)
    expect(value(rows[0]!, "title")).toBe('A < B & "friends" – Black & White / S')
    expect(value(rows[0]!, "id")).toBe("shirt&one-1")
    expect(value(rows[0]!, "link")).toBe("https://example.com/shop/shirt%26one?color=Black+%26+White&size=S")
    expect(value(rows[0]!, "image_link")).toBe("https://images.printify.com/black.jpg?camera=front&size=large")
    expect(xml).toContain("&lt;item /&gt;")
    expect(xml).toContain("&amp;size=large")
  })

  it.each([0, 1, 8, 11, 12, 31, 0xd800, 0xdfff, 0xfffe, 0xffff])(
    "rejects XML-illegal code point %s without deleting source text",
    (point) => {
      const merchantProduct = fixture()
      merchantProduct.product.description += String.fromCodePoint(point)
      expect(() => createMerchantFeed([merchantProduct], siteUrl)).toThrow("invalid XML text")
    }
  )

  it.each([
    { description: " ", error: "invalid description" },
    { description: "a".repeat(5001), error: "invalid description" },
    { description: String.fromCodePoint(1), error: "invalid XML text" },
  ])("does not replace invalid existing description text with a size guide: $error", ({ description, error }) => {
    const merchantProduct = fixture()
    merchantProduct.product.description = description
    merchantProduct.product.sizeGuide = {
      sizes: ["S"],
      measurements: [{ label: "Width, in", values: ["19.00"] }],
    }
    expect(() => createMerchantFeed([merchantProduct], siteUrl)).toThrow(error)
  })

  it.each([
    { label: "a".repeat(5001), error: "invalid description" },
    { label: `Width, in${String.fromCodePoint(1)}`, error: "invalid XML text" },
  ])("applies existing output validation to the chart-only description: $error", ({ label, error }) => {
    const merchantProduct = fixture()
    merchantProduct.product.description = ""
    merchantProduct.product.sizeGuide = { sizes: ["S"], measurements: [{ label, values: ["19.00"] }] }
    expect(() => createMerchantFeed([merchantProduct], siteUrl)).toThrow(error)
  })

  it("fails the whole export when a color has no mapped photo instead of silently deleting those variants", () => {
    const merchantProduct = fixture()
    merchantProduct.product.images = merchantProduct.product.images.filter((image) => !image.variantIds.includes(3))
    merchantProduct.product.artwork = { src: "/artwork.png", alt: "Art", backgroundColor: "#000000" }
    expect(() => createMerchantFeed([merchantProduct], siteUrl)).toThrow("incomplete variant data")
  })

  it.each(["color", "size"] as const)("rejects a missing %s selector", (attribute) => {
    const merchantProduct = fixture()
    merchantProduct.product.variants[0]![attribute] = null
    expect(() => createMerchantFeed([merchantProduct], siteUrl)).toThrow("incomplete variant data")
  })

  it("rejects ambiguous selectors, duplicate variant IDs, and duplicate product IDs", () => {
    const ambiguous = fixture()
    ambiguous.product.variants.push({ ...ambiguous.product.variants[0]!, id: 10 })
    expect(() => createMerchantFeed([ambiguous], siteUrl)).toThrow("incomplete variant data")
    const duplicate = fixture()
    duplicate.product.variants[1]!.id = duplicate.product.variants[0]!.id
    expect(() => createMerchantFeed([duplicate], siteUrl)).toThrow("invalid variant identity")
    expect(() => createMerchantFeed([fixture(), fixture()], siteUrl)).toThrow("invalid product identity")
    const differentCase = fixture()
    differentCase.product.id = differentCase.product.id.toUpperCase()
    expect(() => createMerchantFeed([fixture(), differentCase], siteUrl)).toThrow("invalid product identity")
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 25.5])("rejects invalid cents %s", (price) => {
    const merchantProduct = fixture()
    merchantProduct.product.variants[0]!.price = price
    expect(() => createMerchantFeed([merchantProduct], siteUrl)).toThrow("incomplete variant data")
  })

  it("rejects zero-priced apparel without changing the page's structured data", () => {
    const merchantProduct = fixture()
    merchantProduct.product.variants[0]!.price = 0
    expect(() => createMerchantFeed([merchantProduct], siteUrl)).toThrow("positive price")
    const group = createProductStructuredData(merchantProduct.product, siteUrl)["@graph"].find(
      (item) => item["@type"] === "ProductGroup"
    )!
    expect(group.hasVariant[0]!.offers.price).toBe("0.00")
  })

  it.each(["title", "description"] as const)(
    "rejects absent or overlong %s instead of replacing published copy",
    (attribute) => {
      const merchantProduct = fixture()
      merchantProduct.product[attribute] = " "
      expect(() => createMerchantFeed([merchantProduct], siteUrl)).toThrow(
        `invalid ${attribute === "title" ? "item_group_title" : attribute}`
      )
      merchantProduct.product[attribute] = "x".repeat(attribute === "title" ? 151 : 5001)
      expect(() => createMerchantFeed([merchantProduct], siteUrl)).toThrow(
        `invalid ${attribute === "title" ? "item_group_title" : attribute}`
      )
    }
  )

  it.each([".", "..", " padded "])("rejects product ID %s that would change routing or identity", (id) => {
    const merchantProduct = fixture()
    merchantProduct.product.id = id
    expect(() => createMerchantFeed([merchantProduct], siteUrl)).toThrow("invalid product")
  })

  it.each(["javascript:alert(1)", "http://example.com/photo.jpg", "https://user:secret@example.com/photo.jpg"])(
    "rejects unsafe image %s",
    (src) => {
      const merchantProduct = fixture()
      merchantProduct.product.images = [{ src, alt: "Photo", variantIds: [1, 2, 3] }]
      expect(() => createMerchantFeed([merchantProduct], siteUrl)).toThrow("incomplete variant data")
    }
  )

  it("rejects unsupported advertised image formats while allowing dynamic provider image URLs", () => {
    const merchantProduct = fixture()
    merchantProduct.product.images[0]!.src = "https://example.com/photo.svg"
    expect(() => createMerchantFeed([merchantProduct], siteUrl)).toThrow("unsupported image format")
    merchantProduct.product.images[0]!.src = "https://images-api.printify.com/mockup/product/variant?camera=front"
    expect(items(createMerchantFeed([merchantProduct], siteUrl))).toHaveLength(3)
  })

  it("uses no more than ten additional views", () => {
    const merchantProduct = fixture()
    merchantProduct.product.images.push(
      ...Array.from({ length: 15 }, (_, index) => ({
        src: `https://images.printify.com/extra-${index}.jpg`,
        alt: "Another view",
        variantIds: [1],
      }))
    )
    expect(values(items(createMerchantFeed([merchantProduct], siteUrl))[0]!, "additional_image_link")).toHaveLength(10)
  })

  it.each(["http://example.com", "https://user:password@example.com"])(
    "rejects a non-public canonical origin %s",
    (origin) => {
      expect(() => createMerchantFeed([fixture()], new URL(origin))).toThrow("public HTTPS origin")
    }
  )
})
