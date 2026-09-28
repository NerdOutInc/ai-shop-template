import { beforeEach, describe, expect, it, vi } from "vitest"

import type { CatalogProduct } from "@/features/catalog/catalog-product"
import { getCatalogProduct } from "@/features/catalog/get-catalog-product.server"
import { createMerchantFeed } from "@/features/merchant-feed/create-merchant-feed"

import { resolveMetaCart } from "./resolve-meta-cart.server"

vi.mock("server-only", () => ({}))
vi.mock("@/features/catalog/get-catalog-product.server", () => ({ getCatalogProduct: vi.fn() }))
vi.mock("@/lib/get-site-url", () => ({ getSiteUrl: () => new URL("https://example.com") }))

const product: CatalogProduct = {
  id: "aaaaaaaaaaaaaaaaaaaaaaaa",
  title: "Sample first design — Your Store | Next Level 6210",
  description: "A shirt for good company.",
  addedToShopAt: null,
  salesCount: null,
  image: { src: "https://example.com/clay.jpg", alt: "Clay shirt" },
  images: [
    { src: "https://example.com/black.jpg", alt: "Black shirt", variantIds: [1001] },
    { src: "https://example.com/clay.jpg", alt: "Clay shirt", variantIds: [1003] },
  ],
  price: { currency: "USD", min: 2800, max: 3200 },
  options: [],
  variants: [
    {
      id: 1001,
      title: "Black / M",
      price: 2800,
      currency: "USD",
      available: true,
      color: "Black",
      size: "M",
      options: [],
    },
    {
      id: 1003,
      title: "Clay / XL",
      price: 3200,
      currency: "USD",
      available: true,
      color: "Clay",
      size: "XL",
      options: [],
    },
  ],
  colors: [
    { name: "Black", hex: "#000000" },
    { name: "Clay", hex: "#cc9966" },
  ],
  sizeGuide: null,
  availability: "available",
}

beforeEach(() => {
  vi.mocked(getCatalogProduct).mockReset()
})

describe("Meta cart catalog resolution", () => {
  it("loads each published product once and uses exact variant colors, images and server prices", async () => {
    vi.mocked(getCatalogProduct).mockResolvedValue({ status: "ready", product, isNew: false })
    const result = await resolveMetaCart({ products: `${product.id}-1003:2,${product.id}-1001:1`, price: "1" })
    expect(getCatalogProduct).toHaveBeenCalledExactlyOnceWith(product.id)
    expect(result).toMatchObject({
      status: "ready",
      importKey: expect.stringMatching(/^[a-f0-9]{32}$/),
      items: [
        {
          productId: product.id,
          variantId: 1001,
          title: "Sample first design – Black / M",
          variantTitle: "Black / M",
          image: "https://example.com/black.jpg",
          unitAmount: 2800,
          quantity: 1,
        },
        {
          productId: product.id,
          variantId: 1003,
          title: "Sample first design – Clay / XL",
          variantTitle: "Clay / XL",
          image: "https://example.com/clay.jpg",
          unitAmount: 3200,
          quantity: 2,
        },
      ],
    })
    const same = await resolveMetaCart({ products: `${product.id}-1001:1,${product.id}-1003:1,${product.id}-1003:1` })
    expect(same).toEqual(result)
  })

  it.each([
    {
      title: "Sample Conversation — Your Store | Next Level 6210",
      color: "CVC Midnight Navy",
      expectedTitle: "Sample Conversation – CVC Midnight Navy / M",
      expectedOtherTitle: "Sample Conversation – Clay / XL",
    },
    {
      title: "<Keep> & \"Going\" 'Together' — Your Store | Next Level 6210",
      color: 'Black & "White"',
      expectedTitle: '<Keep> & "Going" \'Together\' – Black & "White" / M',
      expectedOtherTitle: "<Keep> & \"Going\" 'Together' – Clay / XL",
    },
  ])(
    "matches decoded feed names by exact item ID for $title",
    async ({ title, color, expectedTitle, expectedOtherTitle }) => {
      const current: CatalogProduct = {
        ...product,
        title,
        variants: product.variants.map((variant) => (variant.id === 1001 ? { ...variant, color } : variant)),
        colors: [{ name: color, hex: "#000000" }, product.colors[1]!],
      }
      const xml = createMerchantFeed(
        [
          {
            product: current,
            apparel: { googleProductCategory: 212, ageGroup: "adult", gender: "unisex", sizeSystem: "US" },
          },
        ],
        new URL("https://example.com")
      )
      const document = new DOMParser().parseFromString(xml, "application/xml")
      expect(document.querySelector("parsererror")).toBeNull()
      const namespace = "http://base.google.com/ns/1.0"
      const feedTitles = new Map(
        [...document.querySelectorAll("item")].map((row) => [
          row.getElementsByTagNameNS(namespace, "id")[0]!.textContent,
          row.getElementsByTagNameNS(namespace, "title")[0]!.textContent,
        ])
      )
      vi.mocked(getCatalogProduct).mockResolvedValue({ status: "ready", product: current, isNew: false })
      const result = await resolveMetaCart({ products: `${product.id}-1003:5,${product.id}-1001:4` })
      expect(result.status).toBe("ready")
      if (result.status !== "ready") throw new Error("Expected a valid Meta selection")
      expect(result.items).toEqual([
        {
          productId: product.id,
          variantId: 1001,
          title: expectedTitle,
          variantTitle: `${color} / M`,
          image: "https://example.com/black.jpg",
          unitAmount: 2800,
          quantity: 4,
        },
        {
          productId: product.id,
          variantId: 1003,
          title: expectedOtherTitle,
          variantTitle: "Clay / XL",
          image: "https://example.com/clay.jpg",
          unitAmount: 3200,
          quantity: 5,
        },
      ])
      for (const item of result.items) {
        expect(item.title).toBe(feedTitles.get(`${item.productId}-${item.variantId}`))
      }
    }
  )

  it.each([
    { products: "bad:1" },
    { products: `${product.id}-1001:1`, coupon: "SAVE10" },
    { products: "x".repeat(4097) },
  ])("rejects invalid links and coupons before provider reads", async (params) => {
    expect((await resolveMetaCart(params)).status).toBe("error")
    expect(getCatalogProduct).not.toHaveBeenCalled()
  })

  it.each([
    { status: "missing", reason: "unavailable" },
    { status: "unavailable", reason: "lookup" },
  ] as const)(
    "returns no partial selection and distinguishes a $status product from a lookup failure",
    async ({ status, reason }) => {
      vi.mocked(getCatalogProduct)
        .mockResolvedValueOnce({ status: "ready", product, isNew: false })
        .mockResolvedValueOnce({ status })
      expect(await resolveMetaCart({ products: `${product.id}-1001:1,bbbbbbbbbbbbbbbbbbbbbbbb-1001:1` })).toEqual({
        status: "error",
        reason,
      })
    }
  )

  it("offers the known product for an unknown variant without inventing a size or color", async () => {
    vi.mocked(getCatalogProduct).mockResolvedValue({ status: "ready", product, isNew: false })
    expect(await resolveMetaCart({ products: `${product.id}-9999:1` })).toEqual({
      status: "error",
      reason: "unavailable",
      unavailableItem: { title: "Sample first design", variantTitle: null, href: `/shop/${product.id}` },
    })
  })

  it.each([
    { ...product, variants: product.variants.map((variant) => ({ ...variant, available: false })) },
    { ...product, images: [] },
    { ...product, variants: product.variants.map((variant) => ({ ...variant, price: 0 })) },
  ])("names known unavailable or unlistable variants and offers the product's current options", async (current) => {
    vi.mocked(getCatalogProduct).mockResolvedValue({ status: "ready", product: current, isNew: false })
    expect(await resolveMetaCart({ products: `${product.id}-1001:1` })).toEqual({
      status: "error",
      reason: "unavailable",
      unavailableItem: { title: "Sample first design", variantTitle: "Black / M", href: `/shop/${product.id}` },
    })
  })

  it("names a later unavailable selection without returning earlier valid items", async () => {
    vi.mocked(getCatalogProduct).mockResolvedValue({
      status: "ready",
      isNew: false,
      product: {
        ...product,
        variants: product.variants.map((variant) => ({ ...variant, available: variant.id === 1001 })),
      },
    })
    expect(await resolveMetaCart({ products: `${product.id}-1001:1,${product.id}-1003:1` })).toEqual({
      status: "error",
      reason: "unavailable",
      unavailableItem: { title: "Sample first design", variantTitle: "Clay / XL", href: `/shop/${product.id}` },
    })
  })

  it("does not use an unrelated product to identify a failed selection", async () => {
    vi.mocked(getCatalogProduct).mockResolvedValue({
      status: "ready",
      isNew: false,
      product: { ...product, id: "bbbbbbbbbbbbbbbbbbbbbbbb" },
    })
    expect(await resolveMetaCart({ products: `${product.id}-1001:1` })).toEqual({ status: "error", reason: "lookup" })
  })

  it("contains provider errors without exposing credentials or partial products", async () => {
    vi.mocked(getCatalogProduct).mockRejectedValue(new Error("private credential"))
    expect(await resolveMetaCart({ products: `${product.id}-1001:1` })).toEqual({
      status: "error",
      reason: "lookup",
    })
  })
})
