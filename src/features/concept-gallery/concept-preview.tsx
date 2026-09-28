"use client"

import Link from "next/link"

import type { DisplayImageSize } from "@/features/design-library/display-image-sizes"
import type { LibraryArtworkRevision, LibraryDesign } from "@/features/design-library/library-types"

import { GARMENT_COLORS } from "@/features/design-library/garment-colors"

import { ConceptArtwork } from "./concept-artwork"
import { ConceptColorSwatches } from "./concept-color-swatches"
import { getConceptArtworkSource } from "./get-concept-artwork-source"
import { getDesignGarmentColors } from "./get-design-garment-colors"

/** Until a design has garment colours recorded, transparent artwork still needs a backdrop. */
const UNASSIGNED_BACKGROUND = "#e4e9e6"

export function ConceptPreview({
  design,
  revision,
  size,
  selected,
  onSelect,
  showSwatches = true,
  large = false,
}: {
  design: LibraryDesign
  revision: LibraryArtworkRevision | null
  size: DisplayImageSize
  selected: string | null
  onSelect: (name: string) => void
  showSwatches?: boolean
  large?: boolean
}) {
  const colors = getDesignGarmentColors(design)
  const source = getConceptArtworkSource(revision, size)
  // Any garment in the palette can be previewed, not only the design's five: judging a
  // colour before promoting it is the whole point of the detail page's picker.
  const current =
    colors.find((color) => color.name === selected) ??
    GARMENT_COLORS.find((color) => color.name === selected) ??
    colors[0] ??
    null
  // Artwork still on its original matte has no transparency to show a garment through, so
  // it is shown as delivered rather than tinted behind an opaque square. A design with no
  // colours recorded yet gets a neutral stand-in rather than an invisible frame.
  const background = source?.transparent ? (current?.hex ?? UNASSIGNED_BACKGROUND) : "transparent"
  const artwork = (
    <ConceptArtwork revision={revision} title={design.title} background={background} size={size} large={large} />
  )

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {large ? (
        artwork
      ) : (
        <Link
          href={`/admin/concepts/${design.displayNumber}`}
          aria-label={`View design #${design.displayNumber}: ${design.title}`}
          className="block rounded-sm"
        >
          {artwork}
        </Link>
      )}
      {showSwatches && source?.transparent && colors.length > 0 && (
        <ConceptColorSwatches
          colors={colors}
          value={current?.name ?? null}
          onSelect={onSelect}
          label={`Garment color for design #${design.displayNumber}`}
        />
      )}
      {showSwatches && source?.transparent && colors.length === 0 && (
        <p className="text-sm text-muted-foreground">No garment colors chosen for this design yet.</p>
      )}
      {showSwatches && source && !source.transparent && (
        <p className="text-sm text-muted-foreground">
          Garment colors need prepared transparent artwork for this design.
        </p>
      )}
    </div>
  )
}
