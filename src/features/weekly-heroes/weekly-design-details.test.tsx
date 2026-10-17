import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"
import { WeeklyDesignDetails } from "./weekly-design-details"

it("puts the design name, both product photos/destinations and shop link in HTML without executing JavaScript", () => {
  const products = ["T-shirt", "crop top"].map((garment, index) => ({
    id: `sample-${index}`,
    title: `Sample Collection ${garment}`,
    color: "Black",
    href: `/shop/sample-${index}?color=Black`,
    image: { src: `https://cdn.example/sample-${index}.webp`, alt: `Sample Collection ${garment} in Black` },
  }))
  const html = renderToStaticMarkup(
    <WeeklyDesignDetails
      title="Sample Collection"
      liveAt="2026-10-16T22:30:00.000Z"
      products={products}
      siteUrl={new URL("https://store.example")}
    />
  )
  const doc = new DOMParser().parseFromString(html, "text/html")
  expect(doc.querySelector("h2")?.textContent).toBe("Design of the week: Sample Collection")
  expect(doc.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-16T22:30:00.000Z")
  for (const product of products) {
    expect(doc.querySelector(`a[href="${product.href}"]`)?.textContent).toContain(product.title)
    expect(doc.querySelector(`a[href="${product.image.src}"]`)?.textContent).toContain(product.image.alt)
  }
  expect(doc.querySelector('a[href="/shop"]')?.textContent).toContain("Shop all designs")
  const data = JSON.parse(doc.querySelector('script[type="application/ld+json"]')!.textContent!) as {
    relatedLink: string
    temporalCoverage: string
    mainEntity: { itemListElement: { item: { name: string; image: string; url: string } }[] }
  }
  expect(data.relatedLink).toBe("https://store.example/shop")
  expect(
    data.mainEntity.itemListElement.map(({ item }: { item: { name: string; image: string; url: string } }) => item)
  ).toEqual(
    products.map((product) =>
      expect.objectContaining({
        name: product.title,
        image: product.image.src,
        url: `https://store.example${product.href}`,
      })
    )
  )
  expect(data.temporalCoverage).toBe("2026-10-16T22:30:00.000Z/2026-10-23T22:30:00.000Z")
})
