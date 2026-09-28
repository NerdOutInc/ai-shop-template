"use client"

import { storeConfig } from "@/lib/store-config"
import { useState } from "react"
import { Check } from "lucide-react"

import type { CatalogResult } from "./catalog-product"
import { filterProducts, type CatalogSort } from "./filter-products"
import { ProductCard } from "./product-card"
import { useCategorySelection } from "./use-category-selection"

type ProductListProps = { catalog: CatalogResult; initialSort?: CatalogSort }
const sizeOrder = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"]

export function ProductList({ catalog, initialSort = "featured" }: ProductListProps) {
  const [sort, setSort] = useState<CatalogSort>(initialSort)
  const [colors, setColors] = useState<string[]>([])
  const [sizes, setSizes] = useState<string[]>([])
  const [filtersOpen, setFiltersOpen] = useState(false)
  const allCategories = [
    ...new Map(
      catalog.products.flatMap(({ garment }) =>
        garment?.categorySlug && garment.categoryName
          ? [
              [
                garment.categorySlug,
                { slug: garment.categorySlug, name: garment.categoryName, position: garment.categorySortPosition },
              ] as const,
            ]
          : []
      )
    ).values(),
  ].toSorted((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || a.slug.localeCompare(b.slug))
  const { categories, setCategories } = useCategorySelection(allCategories.map((category) => category.slug))
  const allColors = [
    ...new Map(
      catalog.products
        .flatMap((product) =>
          product.colors.filter((color) =>
            product.variants.some((variant) => variant.available && variant.color === color.name)
          )
        )
        .map((color) => [color.name, color])
    ).values(),
  ].toSorted((a, b) => a.name.localeCompare(b.name))
  const allSizes = [
    ...new Set(
      catalog.products.flatMap((product) =>
        product.variants.filter((variant) => variant.available && variant.size !== null).map((variant) => variant.size!)
      )
    ),
  ].toSorted((a, b) => {
    const aIndex = sizeOrder.indexOf(a)
    const bIndex = sizeOrder.indexOf(b)
    return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex) || a.localeCompare(b)
  })
  const fitFilterCount = colors.length + sizes.length
  const hasFilters = fitFilterCount > 0 || categories.length > 0
  const popularityUnavailable =
    catalog.popularityStatus !== "ready" || catalog.products.some((product) => product.salesCount === null)

  const newProducts = new Set(catalog.newProductIds ?? [])
  const products = filterProducts(catalog.products, {
    sort: sort === "popular" && popularityUnavailable ? "featured" : sort,
    colors,
    sizes,
    categories,
    leadingIds: catalog.designOfTheWeekProductIds,
  })

  function toggle(value: string, values: string[], update: (values: string[]) => void) {
    update(values.includes(value) ? values.filter((selected) => selected !== value) : [...values, value])
  }

  if (catalog.status === "empty" || (!storeConfig.configured && catalog.status === "unavailable"))
    return (
      <p className="py-12 leading-relaxed text-muted-foreground">
        Our first collection is on its way. Check back soon.
      </p>
    )
  if (catalog.status === "unavailable")
    return (
      <p className="py-12 leading-relaxed text-muted-foreground" role="status">
        The shop is taking a quick breather. Please try again soon.
      </p>
    )

  return (
    <div>
      {catalog.status === "partial" ? (
        <p className="mb-6 text-sm leading-relaxed text-muted-foreground" role="status">
          Some products couldn’t load. Here’s what we have for now; check back for the rest of the collection.
        </p>
      ) : null}
      {allCategories.length > 1 ? (
        <div
          role="group"
          aria-labelledby="shop-category-label"
          className="flex flex-col gap-3 border-t border-foreground/15 py-4 sm:flex-row sm:items-center sm:gap-6"
        >
          <p id="shop-category-label" className="font-condensed text-sm font-bold tracking-wider uppercase">
            Category
          </p>
          <div className="flex flex-wrap gap-3">
            {allCategories.map((category) => (
              <button
                key={category.slug}
                type="button"
                aria-pressed={categories.includes(category.slug)}
                onClick={() => toggle(category.slug, categories, setCategories)}
                className="inline-flex min-h-11 items-center justify-center gap-1 rounded border border-input bg-secondary py-1.5 pr-1 pl-3 text-sm text-foreground select-none hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-4 aria-pressed:border-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary/90 aria-pressed:hover:text-primary-foreground sm:min-h-0"
              >
                {category.name}
                <Check
                  aria-hidden="true"
                  className={`size-4 ${categories.includes(category.slug) ? "" : "invisible"}`}
                />
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4 border-y border-foreground/15 py-4 lg:mb-10">
        <p aria-live="polite" aria-atomic="true" className="text-sm text-muted-foreground">
          {products.length} {products.length === 1 ? "good thing" : "good things"} to wear
        </p>
        <div className="flex items-center gap-5">
          <button
            type="button"
            onClick={() => setFiltersOpen(!filtersOpen)}
            aria-expanded={filtersOpen}
            aria-controls="shop-filters"
            className="font-condensed min-h-11 text-sm font-bold tracking-wider uppercase underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 lg:hidden"
          >
            Filters{fitFilterCount > 0 ? ` (${fitFilterCount})` : ""} {filtersOpen ? "−" : "+"}
          </button>
          <div className="flex items-center gap-2">
            <label htmlFor="product-sort" className="font-condensed text-sm font-bold tracking-wider uppercase">
              Sort by
            </label>
            <select
              id="product-sort"
              value={sort}
              onChange={(event) => setSort(event.target.value as CatalogSort)}
              className="min-h-11 max-w-40 cursor-pointer rounded-none border-0 bg-transparent py-2 pr-1 pl-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <option value="featured">Featured</option>
              <option value="newest">Newest</option>
              <option value="popular">Most Popular</option>
            </select>
          </div>
        </div>
      </div>
      <div className="grid gap-8 lg:grid-cols-[180px_minmax(0,1fr)] lg:gap-12">
        <aside
          id="shop-filters"
          aria-label="Filter products"
          className={`${filtersOpen ? "block" : "hidden"} border-b border-foreground/15 pb-8 lg:block lg:border-0 lg:pb-0`}
        >
          <div className="mb-6 flex items-center justify-between gap-2">
            <p className="font-condensed text-lg font-bold tracking-wider uppercase">Find your fit</p>
            {hasFilters ? (
              <button
                type="button"
                onClick={() => {
                  setColors([])
                  setSizes([])
                  setCategories([])
                }}
                className="text-xs underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Clear all
              </button>
            ) : null}
          </div>
          {allSizes.length > 0 ? (
            <fieldset className="mb-8">
              <legend className="font-condensed mb-3 text-sm font-bold tracking-wider uppercase">Size</legend>
              <div className="grid grid-cols-3 gap-x-3 lg:grid-cols-2">
                {allSizes.map((size) => (
                  <label key={size} className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm">
                    <input
                      type="checkbox"
                      checked={sizes.includes(size)}
                      onChange={() => toggle(size, sizes, setSizes)}
                      className="size-4 accent-primary focus-visible:outline-2 focus-visible:outline-offset-3"
                    />
                    {size}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          {allColors.length > 0 ? (
            <fieldset>
              <legend className="font-condensed mb-3 text-sm font-bold tracking-wider uppercase">Color</legend>
              <div className="grid gap-x-5 sm:grid-cols-2 lg:grid-cols-1">
                {allColors.map((color) => (
                  <label key={color.name} className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm">
                    <input
                      type="checkbox"
                      checked={colors.includes(color.name)}
                      onChange={() => toggle(color.name, colors, setColors)}
                      className="size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-3"
                    />
                    <span
                      aria-hidden="true"
                      className="size-3.5 shrink-0 rounded-full border border-black/25"
                      style={{ backgroundColor: color.hex ?? "transparent" }}
                    />
                    <span>{color.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <p className="mt-9 max-w-44 text-xs leading-relaxed text-muted-foreground">{storeConfig.tagline}</p>
        </aside>
        <div className="min-w-0">
          {sort === "popular" && popularityUnavailable ? (
            <p role="status" className="mb-6 text-sm leading-relaxed text-muted-foreground">
              Popularity is taking a breather. Showing our featured order for now.
            </p>
          ) : null}
          {sort === "newest" && catalog.products.some((product) => product.addedToShopAt === null) ? (
            <p role="status" className="mb-6 text-sm text-muted-foreground">
              A few arrival dates couldn’t load. Those styles follow the newest arrivals.
            </p>
          ) : null}
          {products.length > 0 ? (
            <ul
              role="list"
              aria-label="Products"
              className="grid grid-cols-1 gap-x-4 gap-y-10 sm:grid-cols-2 sm:gap-x-6 lg:grid-cols-3 lg:gap-y-12"
            >
              {products.map((product, index) => (
                <li key={product.id} className="min-w-0">
                  <ProductCard product={product} priority={index === 0} isNew={newProducts.has(product.id)} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="py-14 text-center">
              <p className="font-display text-3xl">No products match that combination.</p>
              <p className="mt-3 text-sm text-muted-foreground">
                Try another color or size to find your next favorite.
              </p>
              <button
                type="button"
                onClick={() => {
                  setColors([])
                  setSizes([])
                  setCategories([])
                }}
                className="font-condensed mt-6 min-h-11 border-b border-current text-sm font-bold tracking-wider uppercase focus-visible:outline-2 focus-visible:outline-offset-4"
              >
                Clear filters
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
