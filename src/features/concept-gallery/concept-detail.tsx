"use client"

import Link from "next/link"
import { useState } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import type { LibraryCollection, LibraryDesign } from "@/features/design-library/library-types"

import { GARMENT_MODEL } from "@/features/design-library/garment-model"
import { CreateDesignDraftButton } from "@/features/design-products/create-design-draft-button"

import { ConceptArchiveButton } from "./concept-archive-button"
import { ConceptColorManager } from "./concept-color-manager"
import { ConceptPreview } from "./concept-preview"
import { ConceptDownloads } from "./concept-downloads"
import { ConceptFavoriteButton } from "./concept-favorite-button"
import { ConceptProductUses } from "./concept-product-uses"
import { getDesignGarmentColors } from "./get-design-garment-colors"
import { getDisplayedRevision } from "./get-displayed-revision"

export function ConceptDetail({
  design,
  collections,
  revisionId,
}: {
  design: LibraryDesign
  collections: LibraryCollection[]
  revisionId?: string
}) {
  const revision = getDisplayedRevision(design, revisionId)
  const currentCollections = collections.filter((collection) => design.collectionIds.includes(collection.id))
  const offered = getDesignGarmentColors(design)
  const [color, setColor] = useState(design.favoriteColorName ?? offered[0]?.name ?? null)
  // One product per design and model. A finished or historical record owns this tee, so the draft
  // control shows only for a design with none, or to carry on one that was started and not finished.
  const tee = design.products.find(
    (product) => product.productModelId === `printify-blueprint:${GARMENT_MODEL.blueprintId}`
  )
  const unfinished = tee !== undefined && ["reserved", "creating", "needs-reconciliation"].includes(tee.status)

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/admin/concepts"
        className="inline-flex min-h-11 w-fit items-center text-sm underline underline-offset-4"
      >
        ← Back to the design library
      </Link>
      <div className="grid min-w-0 items-start gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:gap-12">
        <div className="flex min-w-0 flex-col gap-5">
          <ConceptPreview design={design} revision={revision} size="large" selected={color} onSelect={setColor} large />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <header>
            <p className="font-condensed mb-3 text-sm font-semibold tracking-widest text-muted-foreground uppercase">
              Design #{design.displayNumber} · {design.family}
            </p>
            <h1 className="display-heading break-words">{design.title}</h1>
            <p className="mt-4 text-muted-foreground">{design.summary}</p>
            {design.state !== "active" && (
              <Badge variant="outline" className="mt-3">
                {design.state === "archived" ? "Archived concept" : "Rejected concept"}
              </Badge>
            )}
          </header>
          {currentCollections.length > 0 && (
            <nav aria-label="Design collections" className="flex flex-wrap gap-x-4 gap-y-1">
              {currentCollections.map((collection) => (
                <Link
                  key={collection.id}
                  href={`/admin/concepts?collection=${encodeURIComponent(collection.id)}`}
                  className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
                >
                  {collection.title}
                </Link>
              ))}
            </nav>
          )}
          <ConceptFavoriteButton
            designId={design.id}
            displayNumber={design.displayNumber}
            revisionId={revision?.id ?? null}
            favoriteRevisionId={design.favoriteRevisionId}
            colorName={color}
          />
          {!revision && (
            <Alert variant="destructive">
              <AlertDescription>
                The selected artwork revision is unavailable. It has not been replaced with a newer file. Reconcile this
                record before creating a product.
              </AlertDescription>
            </Alert>
          )}
          <Separator />
          <ConceptColorManager design={design} selected={color} onSelect={setColor} />
          <Separator />
          <ConceptDownloads revision={revision} />
          <Separator />
          <ConceptProductUses products={design.products} revisionId={revision?.id ?? null} />
          {design.state === "active" && revision && (!tee || unfinished) && (
            <CreateDesignDraftButton
              designId={design.id}
              displayNumber={design.displayNumber}
              revisionId={revision.id}
              resuming={unfinished}
            />
          )}
          {design.state === "active" && (
            <p className="text-sm text-muted-foreground">
              Publish the product in Printify, then choose its week in{" "}
              <Link href="/admin/products" className="underline underline-offset-4">
                Products
              </Link>
              . Each product gets its own place in the shop.
            </p>
          )}
          <Separator />
          <ConceptArchiveButton designId={design.id} displayNumber={design.displayNumber} state={design.state} />
          {(design.mechanism || design.prompt) && (
            <details>
              <summary className="min-h-11 cursor-pointer py-3 text-sm underline underline-offset-4">
                Design notes and generation prompt
              </summary>
              <div className="flex flex-col gap-3 py-3 text-sm text-muted-foreground">
                {design.mechanism && <p>{design.mechanism}</p>}
                {design.prompt && <p className="whitespace-pre-wrap">{design.prompt}</p>}
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  )
}
