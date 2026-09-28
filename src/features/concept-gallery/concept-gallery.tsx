"use client"

import { Heart } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { Button, buttonVariants } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Separator } from "@/components/ui/separator"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { DisplayImageSize } from "@/features/design-library/display-image-sizes"
import { cn } from "@/lib/cn"

import { ConceptCard } from "./concept-card"
import { ConceptGalleryFilters } from "./concept-gallery-filters"
import { conceptGalleryHref } from "./concept-gallery-href"
import type { ConceptGalleryProps } from "./concept-gallery-types"

export function ConceptGallery({ designs, total, collections, filters, options, page, pageSize }: ConceptGalleryProps) {
  const [density, setDensity] = useState<DisplayImageSize>("medium")
  const [filtersOpen, setFiltersOpen] = useState(false)
  const pages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-condensed mb-3 text-sm font-semibold tracking-widest text-muted-foreground uppercase">
            The design library
          </p>
          <h1 className="display-heading">{filters.favoritesOnly ? "My favorites" : "Your design library."}</h1>
          <p className="mt-4 max-w-xl text-muted-foreground">
            Browse the artwork, pick your favorites, and choose what becomes a product.
          </p>
        </div>
        <nav aria-label="Library views" className="flex flex-wrap gap-2">
          <Link
            href="/admin/concepts"
            aria-current={!filters.favoritesOnly ? "page" : undefined}
            className={cn(buttonVariants({ variant: filters.favoritesOnly ? "outline" : "default" }), "min-h-11")}
          >
            All designs
          </Link>
          <Link
            href="/admin/concepts?favorites=1"
            aria-current={filters.favoritesOnly ? "page" : undefined}
            className={cn(buttonVariants({ variant: filters.favoritesOnly ? "default" : "outline" }), "min-h-11")}
          >
            <Heart data-icon="inline-start" aria-hidden="true" />
            My favorites
          </Link>
        </nav>
      </header>
      {filters.favoritesOnly && (
        <p className="text-sm text-muted-foreground">
          Your saved revisions across every collection. The filters below can narrow this view.
        </p>
      )}
      <Separator />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {total.toLocaleString("en-US")} design{total === 1 ? "" : "s"}
          {total > 0 ? ` · Page ${page} of ${pages}` : ""}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <ToggleGroup
            aria-label="Artwork size"
            value={[density]}
            onValueChange={(values) => {
              const next = values[0]
              if (next === "small" || next === "medium" || next === "large") setDensity(next)
            }}
            variant="outline"
          >
            <ToggleGroupItem value="small" aria-label="Small artwork" className="min-h-11 min-w-11">
              S
            </ToggleGroupItem>
            <ToggleGroupItem value="medium" aria-label="Medium artwork" className="min-h-11 min-w-11">
              M
            </ToggleGroupItem>
            <ToggleGroupItem value="large" aria-label="Large artwork" className="min-h-11 min-w-11">
              L
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <Button
          variant="outline"
          className="min-h-11 lg:hidden"
          aria-expanded={filtersOpen}
          aria-controls="concept-filters"
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          Filters {filtersOpen ? "−" : "+"}
        </Button>
      </div>
      <div className="grid items-start gap-8 lg:grid-cols-[210px_minmax(0,1fr)]">
        <aside
          id="concept-filters"
          aria-label="Design filters"
          className={cn(filtersOpen ? "block" : "hidden", "min-w-0 lg:block")}
        >
          <ConceptGalleryFilters collections={collections} filters={filters} options={options} />
        </aside>
        <div className="min-w-0">
          {designs.length > 0 ? (
            <div
              className={cn(
                "grid gap-x-4 gap-y-9 sm:gap-x-6",
                density === "small" && "grid-cols-2 md:grid-cols-3 xl:grid-cols-4",
                density === "medium" && "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3",
                density === "large" && "grid-cols-1 xl:grid-cols-2"
              )}
            >
              {designs.map((design) => (
                <ConceptCard key={design.id} design={design} size={density} />
              ))}
            </div>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>
                  {total > 0 ? "This page has no matching designs." : "No designs match these filters yet."}
                </EmptyTitle>
                <EmptyDescription>
                  {filters.favoritesOnly
                    ? "Save a heart on a design to keep that exact artwork revision here, or clear your filters."
                    : "Try another search or clear the filters. Imported designs appear once their records are ready."}
                </EmptyDescription>
              </EmptyHeader>
              <Link
                href={conceptGalleryHref({ favoritesOnly: filters.favoritesOnly })}
                className={cn(buttonVariants({ variant: "outline" }), "min-h-11")}
              >
                Reset this view
              </Link>
            </Empty>
          )}
          {pages > 1 && (
            <nav aria-label="Design pages" className="mt-10 flex flex-wrap items-center justify-center gap-4">
              {page > 1 && (
                <Link
                  href={conceptGalleryHref(filters, page - 1)}
                  className={cn(buttonVariants({ variant: "outline" }), "min-h-11")}
                >
                  Previous
                </Link>
              )}
              <span className="text-sm">
                Page {page} of {pages}
              </span>
              {page < pages && (
                <Link
                  href={conceptGalleryHref(filters, page + 1)}
                  className={cn(buttonVariants({ variant: "outline" }), "min-h-11")}
                >
                  Next
                </Link>
              )}
            </nav>
          )}
        </div>
      </div>
    </div>
  )
}
