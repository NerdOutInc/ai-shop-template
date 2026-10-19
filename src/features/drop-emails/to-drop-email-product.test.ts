import { describe, expect, it } from "vitest"

import type { CatalogProduct } from "@/features/catalog/catalog-product"

import { toDropEmailProduct } from "./to-drop-email-product"

const product = (overrides: Partial<CatalogProduct> = {}): CatalogProduct => ({
  id: "0a1b2c3d4e5f60718293a4b5",
  title: "Abstract Lines - Premium T-Shirt — Fixture Store",
  description: "A tee for easy weekends.",
  addedToShopAt: "2026-10-05T09:00:00.000Z",
  salesCount: 0,
  image: {
    src: "https://example.public.blob.vercel-storage.com/published-mockups/v1/abstract-lines.jpg",
    alt: "Abstract Lines tee",
  },
  images: [],
  price: { currency: "USD", min: 3000, max: 3400 },
  options: [],
  variants: [],
  colors: [],
  sizeGuide: null,
  availability: "available",
  ...overrides,
})

describe("toDropEmailProduct", () => {
  it("cleans known provider shades in email alt text without editing prose or the source photo", () => {
    const original = product({
      title: "The CVC tee",
      colors: [{ name: "CVC Midnight Navy", hex: "#283244" }],
      image: {
        src: "https://example.com/tee.jpg",
        alt: "The CVC tee in CVC Midnight Navy, beside cvc black lettering",
      },
    })
    expect(toDropEmailProduct(original)).toMatchObject({
      title: "The CVC tee",
      image: { alt: "The CVC tee in Midnight Navy, beside cvc black lettering" },
    })
    expect(original.image?.alt).toBe("The CVC tee in CVC Midnight Navy, beside cvc black lettering")
  })

  it("keeps only what the email shows, with the shop's display title", () => {
    expect(toDropEmailProduct(product())).toEqual({
      id: "0a1b2c3d4e5f60718293a4b5",
      title: "Abstract Lines - Premium T-Shirt",
      image: {
        src: "https://example.public.blob.vercel-storage.com/published-mockups/v1/abstract-lines.jpg",
        alt: "Abstract Lines tee",
      },
      price: { min: 3000, max: 3400 },
    })
  })

  // An inbox has no page to resolve a relative path against, so such an image would only be broken.
  it("drops an image an inbox could not load", () => {
    expect(
      toDropEmailProduct(product({ image: { src: "/images/abstract-lines.jpg", alt: "Abstract Lines tee" } })).image
    ).toBeNull()
    expect(toDropEmailProduct(product({ image: null, price: null }))).toMatchObject({ image: null, price: null })
  })
})
