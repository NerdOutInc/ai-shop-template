"use client"

import { useState } from "react"

import type { DisplayImageSize } from "@/features/design-library/display-image-sizes"
import type { LibraryArtworkRevision } from "@/features/design-library/library-types"
import { cn } from "@/lib/cn"

import { getConceptArtworkSource } from "./get-concept-artwork-source"

type ConceptArtworkProps = {
  revision: LibraryArtworkRevision | null
  title: string
  background: string
  size: DisplayImageSize
  large?: boolean
}

export function ConceptArtwork({ revision, title, background, size, large = false }: ConceptArtworkProps) {
  const [failed, setFailed] = useState(false)
  const source = getConceptArtworkSource(revision, size)
  const missingMessage = [revision?.preview, revision?.print, revision?.original].some(
    (candidate) => candidate?.status === "unavailable"
  )
    ? "Artwork is currently unavailable."
    : "Artwork is awaiting private upload."

  return (
    <div
      className={cn(
        "flex aspect-square w-full items-center justify-center overflow-hidden rounded-sm border border-border",
        large && "lg:aspect-[4/5]"
      )}
      style={{ backgroundColor: background }}
    >
      {source && !failed ? (
        // Protected artwork must bypass Next's public image optimizer and its shared cache.
        // The route derives the browsing size instead, addressed by the master's hash.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={source.src}
          alt={title}
          width={source.width ?? undefined}
          height={source.height ?? undefined}
          loading={large ? "eager" : "lazy"}
          decoding="async"
          className="size-full object-contain p-5 sm:p-8"
          onError={() => setFailed(true)}
        />
      ) : (
        <p className="m-5 rounded-sm bg-background p-4 text-center text-sm text-muted-foreground">
          {source ? "Artwork could not load. Refresh to try again." : missingMessage}
        </p>
      )}
    </div>
  )
}
