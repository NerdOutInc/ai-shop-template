import { describe, expect, it } from "vitest"

import { buildProductMetadata } from "./build-product-metadata"
import { normalizeCatalogProduct } from "./normalize-catalog-product"
import { readProductDescription } from "./read-product-description"

const product = {
  ...normalizeCatalogProduct({
    id: "mana-tee",
    shop_id: 123,
    title: "Rest Restores Mana — Your Store | Next Level 6210",
    description: "<p>Your forearms need a recharge, too.</p>",
    variants: [],
    options: [],
    images: [],
  }),
  image: { src: "https://images.printify.com/mana-front.jpg", alt: "Rest Restores Mana on a navy shirt" },
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
      title: "Braided Script and a Clip - Women's Festival Crop Top",
      garment: {
        manufacturer: "Next Level",
        model: "5080",
        categorySlug: "crop-tops",
        categoryName: "Crop tops",
        categorySortPosition: 3,
        gender: "female",
      },
    })
    const title = "Braided Script and a Clip - Women's Festival Crop Top"
    const description = "Your forearms need a recharge, too. A women's crop top from Your Store."
    expect(metadata).toMatchObject({
      title,
      description,
      openGraph: { title: `${title} | Your Store`, description },
      twitter: { title: `${title} | Your Store`, description },
    })
    expect(JSON.stringify(metadata)).not.toMatch(/unisex|t-shirt/i)
  })

  it.each(["A Collective Noun - Women's Festival Crop Top", "Everyday Type - Women's Festival Crop-Top"])(
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
        title: "A Collective Noun",
        garment: {
          ...product.garment,
          model: "5080",
          categorySlug: "crop-tops",
          categoryName: "Crop tops",
          gender: "female",
        },
      }).title
    ).toBe("A Collective Noun – Crop Top")
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
    const title = `Rest Restores Mana – ${garment.categoryName}`
    expect(metadata).toMatchObject({
      title,
      description: `Your forearms need a recharge, too. ${label} from Your Store.`,
      openGraph: { title: `${title} | Your Store` },
      twitter: { title: `${title} | Your Store` },
    })
    expect(buildProductMetadata({ ...configured, title: `Mana ${garment.categoryName}` }).title).toBe(
      `Mana ${garment.categoryName}`
    )
  })

  it("preserves another configured garment and avoids duplicate labels", () => {
    const metadata = buildProductMetadata({
      ...product,
      title: "Mana Tank Top",
      garment: {
        manufacturer: "Other Maker",
        model: "24",
        categorySlug: "tank-tops",
        categoryName: "Tank tops",
        categorySortPosition: 4,
        gender: "male",
      },
    })
    expect(metadata.title).toBe("Mana Tank Top")
    expect(metadata.description).toContain("A men's tank top from Your Store.")
  })

  it("uses neutral copy for unavailable metadata and the saved name for custom categories", () => {
    const missing = buildProductMetadata({ ...product, garment: null })
    expect(missing.title).toBe("Rest Restores Mana – Apparel")
    expect(missing.description).toContain("Apparel from Your Store.")
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
    expect(custom.description).toContain("Custom layers from Your Store.")
    expect(JSON.stringify([missing, custom])).not.toMatch(/unisex|t-shirt/i)
  })

  it("gives search and both social cards consistent product copy and the actual product photo", () => {
    const metadata = buildProductMetadata(product)
    const description = "Your forearms need a recharge, too. A unisex T-shirt from Your Store."
    const socialTitle = "Rest Restores Mana – T-Shirt | Your Store"
    const images = [{ url: product.image.src, alt: product.image.alt }]
    expect(metadata).toMatchObject({
      title: "Rest Restores Mana – T-Shirt",
      description,
      openGraph: { title: socialTitle, description, images, siteName: "Your Store", type: "website" },
      twitter: { title: socialTitle, description, images, card: "summary_large_image" },
    })
  })

  it("keeps complete design sentences and garment context when a paragraph is too long", () => {
    const metadata = buildProductMetadata({
      ...product,
      ...readProductDescription(
        "<p>A purple pixel-art chalk bag brings a little RPG logic to the gym. Rest is part of the quest; even your forearms need a recharge between long sessions at the wall.</p>"
      ),
    })
    expect(metadata.description).toBe(
      "A purple pixel-art chalk bag brings a little RPG logic to the gym. A unisex T-shirt from Your Store."
    )
    expect(metadata.description!.length).toBeLessThanOrEqual(170)
  })

  it("truncates a long first sentence at a word boundary while retaining garment context", () => {
    const metadata = buildProductMetadata({
      ...product,
      ...readProductDescription(`<p>${"Climb with good company and a little more patience ".repeat(8)}.</p>`),
    })
    expect(metadata.description).toMatch(/\w… A unisex T-shirt from Your Store\.$/)
    expect(metadata.description!.length).toBeLessThanOrEqual(170)
    expect(metadata.description).not.toContain("<p>")
  })

  it("uses the branded image when no product photo exists instead of an empty social image list", () => {
    const metadata = buildProductMetadata({ ...product, image: null })
    expect(metadata.openGraph).toMatchObject({ images: [{ url: "/opengraph-image", alt: expect.any(String) }] })
    expect(metadata.twitter).toMatchObject({ images: [{ url: "/opengraph-image", alt: expect.any(String) }] })
  })

  it("does not repeat a T-shirt label already present in the published title", () => {
    expect(buildProductMetadata({ ...product, title: "Mana T-Shirt — Your Store" }).title).toBe("Mana T-Shirt")
  })
})
