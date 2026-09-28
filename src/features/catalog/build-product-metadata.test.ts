import { describe, expect, it } from "vitest"

import { buildProductMetadata } from "./build-product-metadata"
import { normalizeCatalogProduct } from "./normalize-catalog-product"
import { readProductDescription } from "./read-product-description"

const product = {
  ...normalizeCatalogProduct({
    id: "sample-tee",
    shop_id: 123,
    title: "Sample Garden Illustration — Fixture Store | Next Level 6210",
    description: "<p>A bright illustration for everyday adventures.</p>",
    variants: [],
    options: [],
    images: [],
  }),
  image: { src: "https://images.printify.com/sample-front.jpg", alt: "Sample Garden Illustration on a navy shirt" },
  garment: {
    manufacturer: "Next Level",
    model: "6210",
    categorySlug: "t-shirts",
    categoryName: "T-shirts",
    categorySortPosition: 1,
    gender: "unisex" as const,
  },
}

describe("buildProductMetadata", () => {
  it("uses the crop profile in search and both social cards without tee or unisex claims", () => {
    const metadata = buildProductMetadata({
      ...product,
      title: "Sample Abstract Lines - Women's Festival Crop Top",
      garment: {
        manufacturer: "Next Level",
        model: "5080",
        categorySlug: "crop-tops",
        categoryName: "Crop tops",
        categorySortPosition: 3,
        gender: "female",
      },
    })
    const title = "Sample Abstract Lines - Women's Festival Crop Top"
    const description = "A bright illustration for everyday adventures. A women's crop top from Fixture Store."
    expect(metadata).toMatchObject({
      title,
      description,
      openGraph: { title: `${title} | Fixture Store`, description },
      twitter: { title: `${title} | Fixture Store`, description },
    })
    expect(JSON.stringify(metadata)).not.toMatch(/unisex|t-shirt/i)
  })

  it.each(["Sample Group Illustration - Women's Festival Crop Top", "Everyday Type - Women's Festival Crop-Top"])(
    "keeps an existing crop-top garment label in %s without appending another",
    (title) => {
      expect(
        buildProductMetadata({
          ...product,
          title,
          garment: {
            ...product.garment,
            model: "5080",
            categorySlug: "crop-tops",
            categoryName: "Crop tops",
            gender: "female",
          },
        }).title
      ).toBe(title)
    }
  )

  it("adds crop-top context when the published title names only the design", () => {
    expect(
      buildProductMetadata({
        ...product,
        title: "Sample Group Illustration",
        garment: {
          ...product.garment,
          model: "5080",
          categorySlug: "crop-tops",
          categoryName: "Crop tops",
          gender: "female",
        },
      }).title
    ).toBe("Sample Group Illustration – Crop Top")
  })

  it.each([
    { categorySlug: "hoodies", categoryName: "Hoodies", gender: "unisex" as const, label: "Unisex Hoodies" },
    {
      categorySlug: "sweatshirts",
      categoryName: "Warm layers",
      gender: "female" as const,
      label: "Women's Warm layers",
    },
    {
      categorySlug: "custom-layers",
      categoryName: "Layers (light)",
      gender: "male" as const,
      label: "Men's Layers (light)",
    },
  ])("preserves the saved $categoryName name and gender in search and social metadata", ({ label, ...garment }) => {
    const configured = { ...product, garment: { ...product.garment, ...garment } }
    const metadata = buildProductMetadata(configured)
    const title = `Sample Garden Illustration – ${garment.categoryName}`
    expect(metadata).toMatchObject({
      title,
      description: `A bright illustration for everyday adventures. ${label} from Fixture Store.`,
      openGraph: { title: `${title} | Fixture Store` },
      twitter: { title: `${title} | Fixture Store` },
    })
    expect(buildProductMetadata({ ...configured, title: `Garden ${garment.categoryName}` }).title).toBe(
      `Garden ${garment.categoryName}`
    )
  })

  it("preserves another configured garment and avoids duplicate labels", () => {
    const metadata = buildProductMetadata({
      ...product,
      title: "Garden Tank Top",
      garment: {
        manufacturer: "Other Maker",
        model: "24",
        categorySlug: "tank-tops",
        categoryName: "Tank tops",
        categorySortPosition: 4,
        gender: "male",
      },
    })
    expect(metadata.title).toBe("Garden Tank Top")
    expect(metadata.description).toContain("A men's tank top from Fixture Store.")
  })

  it("uses neutral copy for unavailable metadata and the saved name for custom categories", () => {
    const missing = buildProductMetadata({ ...product, garment: null })
    expect(missing.title).toBe("Sample Garden Illustration – Apparel")
    expect(missing.description).toContain("Apparel from Fixture Store.")
    const custom = buildProductMetadata({
      ...product,
      garment: {
        manufacturer: "Maker",
        model: "Other",
        categorySlug: "constructor",
        categoryName: "Custom layers",
        categorySortPosition: 5,
        gender: null,
      },
    })
    expect(custom.description).toContain("Custom layers from Fixture Store.")
    expect(JSON.stringify([missing, custom])).not.toMatch(/unisex|t-shirt/i)
  })

  it("gives search and both social cards consistent product copy and the actual product photo", () => {
    const metadata = buildProductMetadata(product)
    const description = "A bright illustration for everyday adventures. A unisex T-shirt from Fixture Store."
    const socialTitle = "Sample Garden Illustration – T-Shirt | Fixture Store"
    const images = [{ url: product.image.src, alt: product.image.alt }]
    expect(metadata).toMatchObject({
      title: "Sample Garden Illustration – T-Shirt",
      description,
      openGraph: { title: socialTitle, description, images, siteName: "Fixture Store", type: "website" },
      twitter: { title: socialTitle, description, images, card: "summary_large_image" },
    })
  })

  it("keeps complete design sentences and garment context when a paragraph is too long", () => {
    const metadata = buildProductMetadata({
      ...product,
      ...readProductDescription(
        "<p>A purple geometric garden brings a little color to an everyday scene. Small details tell the story; layered shapes and gentle contrasts invite a longer look at every carefully illustrated corner.</p>"
      ),
    })
    expect(metadata.description).toBe(
      "A purple geometric garden brings a little color to an everyday scene. A unisex T-shirt from Fixture Store."
    )
    expect(metadata.description!.length).toBeLessThanOrEqual(170)
  })

  it("truncates a long first sentence at a word boundary while retaining garment context", () => {
    const metadata = buildProductMetadata({
      ...product,
      ...readProductDescription(`<p>${"Walk with good company and a little more curiosity ".repeat(8)}.</p>`),
    })
    expect(metadata.description).toMatch(/\w… A unisex T-shirt from Fixture Store\.$/)
    expect(metadata.description!.length).toBeLessThanOrEqual(170)
    expect(metadata.description).not.toContain("<p>")
  })

  it("uses the branded image when no product photo exists instead of an empty social image list", () => {
    const metadata = buildProductMetadata({ ...product, image: null })
    expect(metadata.openGraph).toMatchObject({ images: [{ url: "/opengraph-image", alt: expect.any(String) }] })
    expect(metadata.twitter).toMatchObject({ images: [{ url: "/opengraph-image", alt: expect.any(String) }] })
  })

  it("does not repeat a T-shirt label already present in the published title", () => {
    expect(buildProductMetadata({ ...product, title: "Garden T-Shirt — Fixture Store" }).title).toBe("Garden T-Shirt")
  })
})

it.each(["The Goatee", "Committee of Cats"])(
  "does not mistake a word ending in tee for a garment label: %s",
  (title) => {
    expect(buildProductMetadata({ ...product, title }).title).toBe(`${title} – T-Shirt`)
  }
)

it.each(["Otter Tee", "Otter Tees", "Everyday T-shirts"])("keeps an existing complete garment word: %s", (title) => {
  expect(buildProductMetadata({ ...product, title }).title).toBe(title)
})
