import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type { CatalogProduct } from "./catalog-product"
import { ProductStructuredData } from "./product-structured-data"

describe("ProductStructuredData", () => {
  it("renders parseable JSON-LD in server HTML without letting catalog text end the script element", () => {
    const maliciousText = '</script><script>alert("unexpected send")</script>'
    const product: CatalogProduct = {
      id: "shirt",
      title: maliciousText,
      description: maliciousText,
      addedToShopAt: null,
      salesCount: null,
      image: null,
      images: [{ src: "https://example.com/photo.jpg", alt: "Shirt", variantIds: [1] }],
      price: { currency: "USD", min: 2500, max: 2500 },
      variants: [
        {
          id: 1,
          title: "Black / S",
          color: "Black",
          size: "S",
          currency: "USD",
          price: 2500,
          available: true,
          options: [],
        },
      ],
      options: [],
      colors: [{ name: "Black", hex: null }],
      sizeGuide: null,
      availability: "available",
    }

    const html = renderToStaticMarkup(
      <ProductStructuredData product={product} siteUrl={new URL("https://example.com")} />
    )
    const document = new DOMParser().parseFromString(html, "text/html")
    const scripts = document.querySelectorAll("script")
    expect(scripts).toHaveLength(1)
    expect(scripts[0]?.type).toBe("application/ld+json")
    expect(html.match(/<\/script>/g)).toHaveLength(1)
    expect(scripts[0]?.textContent).not.toContain("<")
    const data = JSON.parse(scripts[0]!.textContent!)
    expect(data).toMatchObject({
      "@graph": [
        {
          "@type": "ProductGroup",
          name: maliciousText,
          description: maliciousText,
          hasVariant: [{ offers: { price: "25.00" } }],
        },
        { "@type": "BreadcrumbList" },
      ],
    })
  })
})
