import { describe, expect, it } from "vitest"

import type { CatalogProduct } from "./catalog-product"
import { filterProducts } from "./filter-products"

function product(id: string, addedToShopAt: string | null, salesCount: number): CatalogProduct {
  return {
    id,
    title: id,
    description: "",
    addedToShopAt,
    salesCount,
    image: null,
    images: [],
    price: null,
    options: [],
    colors: [],
    sizeGuide: null,
    availability: "available",
    variants: [
      {
        id: 1,
        title: "Black / M",
        price: 2800,
        currency: "USD",
        available: true,
        color: "Black",
        size: "M",
        options: [],
      },
    ],
  }
}

// Featured order is the array order; newest is 2026 then 2025 then 2024; popular is c then b then a.
const catalog = [product("a", "2024-01-01", 1), product("b", "2025-01-01", 5), product("c", "2026-01-01", 9)]
const ids = (products: CatalogProduct[]) => products.map((entry) => entry.id)

function categorizedProduct(id: string, categorySlug: string | null): CatalogProduct {
  return {
    ...product(id, "2026-01-01", 1),
    garment: {
      manufacturer: "Next Level",
      model: "",
      categoryName: categorySlug,
      categorySortPosition: categorySlug ? 1 : null,
      categorySlug,
      gender: null,
    },
  }
}

describe("filterProducts", () => {
  it.each([
    { categories: undefined, expected: ["tee", "crop", "unassigned", "missing", "unknown"] },
    { categories: [], expected: ["tee", "crop", "unassigned", "missing", "unknown"] },
    { categories: ["t-shirts"], expected: ["tee"] },
    { categories: ["crop-tops"], expected: ["crop"] },
    { categories: ["t-shirts", "crop-tops"], expected: ["tee", "crop"] },
    { categories: ["unknown-category"], expected: [] },
  ])("matches saved category identities for $categories", ({ categories, expected }) => {
    const products = [
      { ...categorizedProduct("tee", "t-shirts"), title: "A misleading crop top title" },
      { ...categorizedProduct("crop", "crop-tops"), title: "A misleading T-shirt title" },
      categorizedProduct("unassigned", null),
      product("missing", null, 0),
      { ...product("unknown", null, 0), garment: null },
    ]
    expect(ids(filterProducts(products, { categories, colors: [], sizes: [], sort: "featured" }))).toEqual(expected)
  })

  it("combines categories with color and size on the same purchasable variant", () => {
    const tee = categorizedProduct("tee", "t-shirts")
    const crop = categorizedProduct("crop", "crop-tops")
    const splitSizes = {
      ...categorizedProduct("split-sizes", "t-shirts"),
      variants: [
        { ...tee.variants[0]!, color: "Black", size: "S" },
        { ...tee.variants[0]!, id: 2, color: "White", size: "M" },
      ],
    }
    const unavailable = {
      ...categorizedProduct("unavailable", "t-shirts"),
      variants: [{ ...tee.variants[0]!, available: false }],
      availability: "unavailable" as const,
    }
    const products = [tee, crop, splitSizes, unavailable]
    expect(
      ids(filterProducts(products, { categories: ["t-shirts"], colors: ["Black"], sizes: ["M"], sort: "featured" }))
    ).toEqual(["tee"])
    expect(
      ids(
        filterProducts(products, {
          categories: ["t-shirts", "crop-tops"],
          colors: ["Black"],
          sizes: ["M"],
          sort: "featured",
        })
      )
    ).toEqual(["tee", "crop"])
    expect(
      ids(filterProducts(products, { categories: ["t-shirts"], colors: [], sizes: [], sort: "featured" }))
    ).toEqual(["tee", "split-sizes", "unavailable"])
  })

  it.each([
    { sort: "featured", expected: ["new-tee", "old-tee"] },
    { sort: "newest", expected: ["new-tee", "old-tee"] },
    { sort: "popular", expected: ["old-tee", "new-tee"] },
  ] as const)("preserves $sort ordering after category filtering", ({ sort, expected }) => {
    const products = [
      { ...categorizedProduct("old-tee", "t-shirts"), addedToShopAt: "2024-01-01", salesCount: 9 },
      { ...categorizedProduct("crop", "crop-tops"), addedToShopAt: "2026-01-01", salesCount: 30 },
      { ...categorizedProduct("new-tee", "t-shirts"), addedToShopAt: "2025-01-01", salesCount: 1 },
    ]
    expect(
      ids(
        filterProducts(products, {
          categories: ["t-shirts"],
          colors: [],
          sizes: [],
          sort,
          leadingIds: ["crop", "new-tee"],
        })
      )
    ).toEqual(expected)
  })

  it("keeps the saved order under Featured and sorts the other two", () => {
    expect(ids(filterProducts(catalog, { colors: [], sizes: [], sort: "featured" }))).toEqual(["a", "b", "c"])
    expect(ids(filterProducts(catalog, { colors: [], sizes: [], sort: "newest" }))).toEqual(["c", "b", "a"])
    expect(ids(filterProducts(catalog, { colors: [], sizes: [], sort: "popular" }))).toEqual(["c", "b", "a"])
  })

  it("leads Featured with this week's drop, keeping everything else in order", () => {
    expect(ids(filterProducts(catalog, { colors: [], sizes: [], sort: "featured", leadingIds: ["c"] }))).toEqual([
      "c",
      "a",
      "b",
    ])
  })

  // Newest claims when a tee reached the shop. A drop revealed on its Monday is already the newest
  // arrival without help, and pinning it would put it above a tee the owner showed on Tuesday.
  it("never leads Newest with the drop, because that would be a claim about arrival", () => {
    expect(ids(filterProducts(catalog, { colors: [], sizes: [], sort: "newest", leadingIds: ["a"] }))).toEqual([
      "c",
      "b",
      "a",
    ])
    const week = [
      product("monday-drop", "2026-09-21T04:00:00.000Z", 0),
      product("tuesday-show", "2026-09-22T17:30:00.000Z", 0),
      product("older", "2026-09-01T12:00:00.000Z", 3),
    ]
    expect(ids(filterProducts(week, { colors: [], sizes: [], sort: "newest", leadingIds: ["monday-drop"] }))).toEqual([
      "tuesday-show",
      "monday-drop",
      "older",
    ])
  })

  // Most Popular is the one sort that claims something factual about what other people bought.
  it("never leads Most Popular with the drop, because that would be a claim about sales", () => {
    expect(ids(filterProducts(catalog, { colors: [], sizes: [], sort: "popular", leadingIds: ["a"] }))).toEqual([
      "c",
      "b",
      "a",
    ])
  })

  // Stable, so tees that arrived together keep the Featured order they came in with.
  it("keeps the incoming order for tees that arrived at the same moment", () => {
    const sameMoment = "2026-09-14T12:00:00.000Z"
    const tied = [
      product("first", sameMoment, 0),
      product("later", "2026-09-15T12:00:00.000Z", 0),
      product("second", sameMoment, 0),
      product("third", sameMoment, 0),
    ]
    expect(ids(filterProducts(tied, { colors: [], sizes: [], sort: "newest" }))).toEqual([
      "later",
      "first",
      "second",
      "third",
    ])
  })

  it("puts tees with no usable arrival after every dated one, in their incoming order", () => {
    const undated = [
      product("missing", null, 0),
      product("old", "2024-01-01T00:00:00.000Z", 0),
      product("garbled", "not-a-date", 0),
      product("new", "2026-09-22T00:00:00.000Z", 0),
    ]
    expect(ids(filterProducts(undated, { colors: [], sizes: [], sort: "newest" }))).toEqual([
      "new",
      "old",
      "missing",
      "garbled",
    ])
  })

  it("keeps the drop's own relative order when it holds several tees", () => {
    expect(ids(filterProducts(catalog, { colors: [], sizes: [], sort: "featured", leadingIds: ["b", "c"] }))).toEqual([
      "b",
      "c",
      "a",
    ])
  })

  it("changes nothing when there is no drop, or when its tees are filtered out", () => {
    expect(ids(filterProducts(catalog, { colors: [], sizes: [], sort: "featured", leadingIds: [] }))).toEqual([
      "a",
      "b",
      "c",
    ])
    expect(ids(filterProducts(catalog, { colors: [], sizes: [], sort: "featured", leadingIds: ["gone"] }))).toEqual([
      "a",
      "b",
      "c",
    ])
  })

  it("still filters by colour and size while leading", () => {
    const filtered = filterProducts(catalog, { colors: ["Black"], sizes: ["M"], sort: "featured", leadingIds: ["c"] })
    expect(ids(filtered)).toEqual(["c", "a", "b"])
    expect(ids(filterProducts(catalog, { colors: ["Clay"], sizes: [], sort: "featured", leadingIds: ["c"] }))).toEqual(
      []
    )
  })
})
