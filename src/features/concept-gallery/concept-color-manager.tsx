"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { GARMENT_COLORS } from "@/features/design-library/garment-colors"
import type { LibraryDesign } from "@/features/design-library/library-types"

import { ConceptColorSwatches } from "./concept-color-swatches"
import { getDesignGarmentColors } from "./get-design-garment-colors"

/**
 * Every colour Printify offers for this garment, so a design's five can be judged against
 * the real range. Promotion is explicit and a full set asks for a removal first, because
 * silently dropping a colour would discard a decision without showing the trade.
 */
export function ConceptColorManager({
  design,
  selected,
  onSelect,
}: {
  design: LibraryDesign
  selected: string | null
  onSelect: (name: string) => void
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const offered = getDesignGarmentColors(design)
  const isOffered = offered.some((color) => color.name === selected)
  const full = offered.length >= 5

  async function change(method: "POST" | "DELETE") {
    if (!selected || pending) return
    setPending(true)
    setError(null)
    try {
      const response = await fetch(`/api/admin/concepts/${encodeURIComponent(design.id)}/colors`, {
        method,
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colorName: selected }),
      })
      if (!response.ok) {
        setError(
          response.status === 409
            ? "This design already offers five colors. Remove one before adding another."
            : "That change could not be saved. Try again, or sign in again if your session has ended."
        )
        return
      }
      router.refresh()
    } catch {
      setError("That change could not be confirmed. Refresh before trying again.")
    } finally {
      setPending(false)
    }
  }

  return (
    <section aria-labelledby="colors-heading" className="flex flex-col gap-4">
      <h2 id="colors-heading" className="font-condensed text-2xl font-semibold">
        Garment colors
      </h2>
      <p className="text-sm text-muted-foreground">
        The five colors offered for this design. Pick any color below to see the artwork on it.
      </p>
      <ConceptColorSwatches colors={GARMENT_COLORS} value={selected} onSelect={onSelect} label="All garment colors" />
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm">
          {selected ? (
            <>
              <span className="font-semibold">{selected}</span>
              {isOffered ? " is one of the five." : " is not offered yet."}
            </>
          ) : (
            "Pick a color to review it."
          )}
        </p>
        {selected && !isOffered && (
          <Button className="min-h-11" disabled={pending || full} onClick={() => change("POST")}>
            {pending ? "Saving…" : "Add to the five"}
          </Button>
        )}
        {selected && isOffered && (
          <Button variant="outline" className="min-h-11" disabled={pending} onClick={() => change("DELETE")}>
            {pending ? "Saving…" : "Remove from the five"}
          </Button>
        )}
      </div>
      {selected && !isOffered && full && (
        <p className="text-sm text-muted-foreground">
          This design already offers five colors. Remove one before adding {selected}.
        </p>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </section>
  )
}
