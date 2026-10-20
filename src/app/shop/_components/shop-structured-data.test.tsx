import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"

import { normalizeCatalogProduct } from "@/features/catalog/normalize-catalog-product"
import { createCatalogFixture } from "../../../../test/create-catalog-fixture"

import { ShopStructuredData } from "./shop-structured-data"

function readJsonLd(html: string): unknown {
  const script = new DOMParser().parseFromString(html, "text/html").querySelector("script")
  return JSON.parse(script?.textContent ?? "null")
}

it("lists every shop product in order with canonical product URLs", () => {
  const products = [createCatalogFixture("first"), createCatalogFixture("a&b")].map(normalizeCatalogProduct)
  const html = renderToStaticMarkup(
    <ShopStructuredData products={products} siteUrl={new URL("https://store.example")} />
  )
  expect(readJsonLd(html)).toEqual({
    "@context": "https://schema.org",
    "@type": "ItemList",
    "@id": "https://store.example/shop#products",
    numberOfItems: 2,
    itemListElement: [
      { "@type": "ListItem", position: 1, url: "https://store.example/shop/first" },
      { "@type": "ListItem", position: 2, url: "https://store.example/shop/a%26b" },
    ],
  })
})

it("renders nothing for an empty or unavailable catalog", () => {
  expect(renderToStaticMarkup(<ShopStructuredData products={[]} siteUrl={new URL("https://store.example")} />)).toBe("")
})
