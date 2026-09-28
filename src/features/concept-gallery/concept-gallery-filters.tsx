import Link from "next/link"

import { Button, buttonVariants } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { cn } from "@/lib/cn"

import type { ConceptGalleryProps } from "./concept-gallery-types"

export function ConceptGalleryFilters({
  collections,
  filters,
  options,
}: Pick<ConceptGalleryProps, "collections" | "filters" | "options">) {
  return (
    <form action="/admin/concepts" method="get" aria-label="Filter design library" className="flex flex-col gap-5">
      {filters.favoritesOnly && <input type="hidden" name="favorites" value="1" />}
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="concept-search">Search designs</FieldLabel>
          <Input
            id="concept-search"
            name="search"
            type="search"
            defaultValue={filters.search ?? ""}
            placeholder="Number, title or idea"
            className="min-h-11"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="concept-collection">Collection</FieldLabel>
          <NativeSelect
            id="concept-collection"
            name="collection"
            defaultValue={filters.collectionId ?? ""}
            className="w-full [&_select]:min-h-11"
          >
            <NativeSelectOption value="">All collections</NativeSelectOption>
            {collections.map((collection) => (
              <NativeSelectOption key={collection.id} value={collection.id}>
                {collection.title} ({collection.designCount})
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="concept-family">Theme / family</FieldLabel>
          <NativeSelect
            id="concept-family"
            name="family"
            defaultValue={filters.family ?? ""}
            className="w-full [&_select]:min-h-11"
          >
            <NativeSelectOption value="">All themes</NativeSelectOption>
            {options.families.map((family) => (
              <NativeSelectOption key={family} value={family}>
                {family}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="concept-model">Product model</FieldLabel>
          <NativeSelect
            id="concept-model"
            name="model"
            defaultValue={filters.productModelId ?? ""}
            className="w-full [&_select]:min-h-11"
          >
            <NativeSelectOption value="">All models</NativeSelectOption>
            {options.productModels.map((model) => (
              <NativeSelectOption key={model.id} value={model.id}>
                {model.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="concept-status">Product / artwork state</FieldLabel>
          <NativeSelect
            id="concept-status"
            name="status"
            defaultValue={filters.status ?? ""}
            className="w-full [&_select]:min-h-11"
          >
            <NativeSelectOption value="">All states</NativeSelectOption>
            <NativeSelectOption value="no-product">No product yet</NativeSelectOption>
            <NativeSelectOption value="draft">Draft exists</NativeSelectOption>
            <NativeSelectOption value="published">In store</NativeSelectOption>
            <NativeSelectOption value="needs-artwork">Needs artwork preparation</NativeSelectOption>
            <NativeSelectOption value="unverified">Product check needed</NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="concept-design-state">Design state</FieldLabel>
          <NativeSelect
            id="concept-design-state"
            name="state"
            defaultValue={filters.designState ?? "active"}
            className="w-full [&_select]:min-h-11"
          >
            <NativeSelectOption value="active">Active designs</NativeSelectOption>
            <NativeSelectOption value="archived">Archived designs</NativeSelectOption>
            <NativeSelectOption value="rejected">Rejected designs</NativeSelectOption>
          </NativeSelect>
        </Field>
      </FieldGroup>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="min-h-11">
          Apply filters
        </Button>
        <Link
          href={filters.favoritesOnly ? "/admin/concepts?favorites=1" : "/admin/concepts"}
          className={cn(buttonVariants({ variant: "ghost" }), "min-h-11")}
        >
          Clear filters
        </Link>
      </div>
    </form>
  )
}
