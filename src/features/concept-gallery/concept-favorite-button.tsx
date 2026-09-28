"use client"

import { Heart } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

type ConceptFavoriteButtonProps = {
  designId: string
  displayNumber: number
  revisionId: string | null
  favoriteRevisionId: string | null
  colorName: string | null
  compact?: boolean
}

export function ConceptFavoriteButton({
  designId,
  displayNumber,
  revisionId,
  favoriteRevisionId,
  colorName,
  compact = false,
}: ConceptFavoriteButtonProps) {
  const router = useRouter()
  const [savedRevision, setSavedRevision] = useState(favoriteRevisionId)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selected = savedRevision === revisionId && revisionId !== null
  const anotherRevisionSaved = savedRevision !== null && !selected
  const label = selected ? `Remove design #${displayNumber} from my favorites` : `Favorite design #${displayNumber}`

  async function toggleFavorite() {
    if (!revisionId || pending) return
    setPending(true)
    setError(null)
    try {
      const response = await fetch(`/api/admin/concepts/${encodeURIComponent(designId)}/favorite`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        // The garment on screen is part of the judgement, so it is saved with the revision.
        body: JSON.stringify({ selected: !selected, revisionId, colorName }),
      })
      if (!response.ok) {
        setError(
          response.status === 409
            ? "This selection changed. Refresh to review the saved revision before trying again."
            : "Your favorite could not be saved. Try again, or sign in again if your session has ended."
        )
        return
      }
      const result: unknown = await response.json()
      if (
        !result ||
        typeof result !== "object" ||
        !("selected" in result) ||
        !("revisionId" in result) ||
        typeof result.selected !== "boolean" ||
        (result.selected ? result.revisionId !== revisionId : result.revisionId !== null)
      ) {
        setError("The saved selection could not be confirmed. Refresh before trying again.")
        return
      }
      setSavedRevision(result.selected ? revisionId : null)
      router.refresh()
    } catch {
      setError("Your favorite could not be confirmed. Refresh before trying again.")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant={selected ? "default" : "outline"}
        size={compact ? "icon-lg" : "lg"}
        className={compact ? "size-11" : "min-h-11"}
        aria-label={anotherRevisionSaved ? `Save this revision of design #${displayNumber} to my favorites` : label}
        aria-pressed={selected}
        disabled={pending || !revisionId}
        onClick={toggleFavorite}
      >
        <Heart data-icon="inline-start" aria-hidden="true" fill={selected ? "currentColor" : "none"} />
        {!compact &&
          (pending
            ? "Saving…"
            : selected
              ? "Saved to my favorites"
              : anotherRevisionSaved
                ? "Save this revision to favorites"
                : "Save to my favorites")}
      </Button>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
