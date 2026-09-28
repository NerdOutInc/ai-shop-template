"use client"

import { Archive, ArchiveRestore } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import type { LibraryDesign } from "@/features/design-library/library-types"

export function ConceptArchiveButton({
  designId,
  displayNumber,
  state,
  compact = false,
}: {
  designId: string
  displayNumber: number
  state: LibraryDesign["state"]
  /** Icon-only, for triaging a grid of cards without leaving it. */
  compact?: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const archived = state !== "active"
  const label = archived ? `Restore design #${displayNumber} to the library` : `Archive design #${displayNumber}`

  async function setState(next: LibraryDesign["state"]) {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const response = await fetch(`/api/admin/concepts/${encodeURIComponent(designId)}/state`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: next }),
      })
      if (!response.ok) {
        setError("That change could not be saved. Try again, or sign in again if your session has ended.")
        return
      }
      // The card leaves the grid on the next render, because the library shows active
      // designs unless the Design state filter asks otherwise.
      router.refresh()
    } catch {
      setError("That change could not be confirmed. Refresh before trying again.")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="outline"
        size={compact ? "icon-lg" : "lg"}
        className={compact ? "size-11" : "min-h-11 w-fit"}
        aria-label={compact ? label : undefined}
        title={compact ? label : undefined}
        disabled={pending}
        onClick={() => setState(archived ? "active" : "archived")}
      >
        {archived ? (
          <ArchiveRestore data-icon={compact ? undefined : "inline-start"} aria-hidden="true" />
        ) : (
          <Archive data-icon={compact ? undefined : "inline-start"} aria-hidden="true" />
        )}
        {!compact && (pending ? "Saving…" : label)}
      </Button>
      {!compact && !archived && (
        <p className="text-sm text-muted-foreground">
          Archiving hides this design from the library unless you filter for archived designs. Nothing is deleted.
        </p>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
