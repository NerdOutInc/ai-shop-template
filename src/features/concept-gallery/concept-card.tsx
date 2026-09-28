"use client"

import Link from "next/link"
import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import type { DisplayImageSize } from "@/features/design-library/display-image-sizes"
import type { LibraryDesign } from "@/features/design-library/library-types"

import { ConceptArchiveButton } from "./concept-archive-button"
import { ConceptPreview } from "./concept-preview"
import { ConceptFavoriteButton } from "./concept-favorite-button"
import { getDesignGarmentColors } from "./get-design-garment-colors"
import { getDisplayedRevision } from "./get-displayed-revision"

export function ConceptCard({ design, size }: { design: LibraryDesign; size: DisplayImageSize }) {
  const colors = getDesignGarmentColors(design)
  const [color, setColor] = useState(design.favoriteColorName ?? colors[0]?.name ?? null)
  const revision = getDisplayedRevision(design)
  const published = design.products.filter(
    (product) => product.status === "published" && product.verifiedAt !== null
  ).length
  const drafts = design.products.filter((product) => product.status === "draft" && product.verifiedAt !== null).length
  const unresolved = design.products.some(
    (product) => !product.verifiedAt || !["draft", "published"].includes(product.status)
  )

  return (
    <article aria-label={`Design #${design.displayNumber}: ${design.title}`} className="flex min-w-0 flex-col gap-3">
      <ConceptPreview
        design={design}
        revision={revision}
        size={size}
        selected={color}
        onSelect={setColor}
        // Small density is for scanning many designs at once, where a wrapped row of
        // swatches adds about 90px to every card and pushes the artwork off screen.
        showSwatches={size !== "small"}
      />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            #{design.displayNumber} · {design.family}
          </p>
          <h2 className="font-condensed mt-1 text-xl leading-tight font-semibold">
            <Link href={`/admin/concepts/${design.displayNumber}`} className="hover:underline">
              {design.title}
            </Link>
          </h2>
        </div>
        <div className="flex shrink-0 items-start gap-1">
          <ConceptFavoriteButton
            key={`${revision?.id}:${design.favoriteRevisionId}`}
            designId={design.id}
            displayNumber={design.displayNumber}
            revisionId={revision?.id ?? null}
            favoriteRevisionId={design.favoriteRevisionId}
            colorName={color}
            compact
          />
          <ConceptArchiveButton
            designId={design.id}
            displayNumber={design.displayNumber}
            state={design.state}
            compact
          />
        </div>
      </div>
      <p className="line-clamp-2 text-sm text-muted-foreground">{design.summary}</p>
      <div className="flex flex-wrap gap-1.5">
        {published > 0 && <Badge>{published} in store</Badge>}
        {drafts > 0 && (
          <Badge variant="secondary">
            {drafts} draft{drafts === 1 ? "" : "s"}
          </Badge>
        )}
        {design.products.length === 0 && <Badge variant="outline">No product yet</Badge>}
        {unresolved && <Badge variant="outline">Product check needed</Badge>}
        {revision?.printReadiness !== "ready" && <Badge variant="outline">Needs artwork preparation</Badge>}
        {design.state !== "active" && (
          <Badge variant="outline">{design.state === "archived" ? "Archived" : "Rejected"}</Badge>
        )}
      </div>
      {!revision && design.favoriteRevisionId && (
        <p className="text-sm text-destructive">Saved revision is unavailable. Review this design before using it.</p>
      )}
    </article>
  )
}
