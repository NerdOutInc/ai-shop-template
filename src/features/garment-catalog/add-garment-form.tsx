"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"

import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import type { ShopCategory } from "./garment-catalog"
import { GarmentModelForm } from "./garment-model-form"
import { parsePrintifyBlueprintReference, type PrintifyBlueprintReference } from "./parse-printify-blueprint-reference"

type AddGarmentFormProps = {
  categories: ShopCategory[]
  /** Blueprints the page already lists. Adding one of them jumps to its card instead of doubling it. */
  listedBlueprintIds: number[]
}

type Refusal = Extract<PrintifyBlueprintReference, { ok: false }>["reason"]

// None of these repeat what was pasted: the text is the owner's clipboard, not something to echo.
const refusals: Record<Refusal, string> = {
  empty: "Paste a Printify catalog link, or type a blueprint number.",
  "product-link":
    "That link is one of your products, not a garment in Printify's catalog. Open the garment under Catalog in Printify and paste that page's address.",
  "not-printify":
    "That is not a Printify catalog link. Paste one that starts with https://printify.com/app/products/, or type the blueprint number.",
  "not-a-catalog-page":
    "That Printify page is not a garment's catalog page. Its address looks like https://printify.com/app/products/1317/, with the blueprint number after /products/.",
  "invalid-id": "A blueprint number is a whole number such as 1317. Check it and try again.",
}

/**
 * Start setting up a garment before any product uses it, from a pasted catalog link or a number.
 *
 * The link is parsed right here and only ever yields an integer. It is never fetched, never sent
 * and never rendered; every request the revealed form makes carries the number alone. A refused
 * paste therefore costs no network call at all.
 */
export function AddGarmentForm({ categories, listedBlueprintIds }: AddGarmentFormProps) {
  const [reference, setReference] = useState("")
  const [refusal, setRefusal] = useState<Refusal | null>(null)
  const [draft, setDraft] = useState<number | null>(null)
  const [status, setStatus] = useState("")
  const [savedDraft, setSavedDraft] = useState<number | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const followed = useRef<number | null>(null)
  // Derived, not stored: once a save puts this blueprint in the page's list, the draft steps aside
  // in the same render, so two forms never share one garment's ids.
  const drafting = draft !== null && !listedBlueprintIds.includes(draft) ? draft : null

  // The revealed form replaces nothing, but it appears below the button that was just pressed.
  // Carry keyboard and screen-reader users to it, as the draft review does.
  useEffect(() => {
    if (drafting !== null) heading.current?.focus()
  }, [drafting])

  // After its first save the garment belongs to the list above, and this form is gone with whatever
  // had focus inside it. Follow the garment there, unless the owner has already moved on.
  useEffect(() => {
    if (draft === null || drafting !== null || followed.current === draft) return
    followed.current = draft
    if (document.activeElement && document.activeElement !== document.body) return
    document.getElementById(`garment-${draft}`)?.focus()
  }, [draft, drafting])

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = parsePrintifyBlueprintReference(reference)
    setStatus("")
    if (!parsed.ok) {
      setRefusal(parsed.reason)
      input.current?.focus()
      return
    }
    setRefusal(null)
    setReference("")
    if (listedBlueprintIds.includes(parsed.blueprintId)) {
      setDraft(null)
      setStatus(`Blueprint ${parsed.blueprintId} is already listed above.`)
      document.getElementById(`garment-${parsed.blueprintId}`)?.focus()
      return
    }
    followed.current = null
    setDraft(parsed.blueprintId)
  }

  function cancel() {
    setDraft(null)
    input.current?.focus()
  }

  return (
    <section aria-labelledby="add-garment-heading" className="flex flex-col gap-4 rounded-lg border p-4 sm:p-6">
      <h2 id="add-garment-heading" className="font-condensed text-xl font-bold tracking-wide uppercase">
        Add a garment
      </h2>
      <p className="text-sm text-muted-foreground">
        Garments your published products already use appear above on their own. Add one here to get it ready before its
        first product lands.
      </p>
      <form noValidate className="flex flex-col gap-3" onSubmit={add}>
        <Field data-invalid={refusal ? true : undefined}>
          <FieldLabel htmlFor="add-garment-reference">Printify catalog link or blueprint number</FieldLabel>
          <Input
            ref={input}
            id="add-garment-reference"
            value={reference}
            placeholder="https://printify.com/app/products/1317/…"
            autoComplete="off"
            spellCheck={false}
            className="min-h-11"
            aria-invalid={refusal ? true : undefined}
            aria-describedby={
              refusal ? "add-garment-reference-hint add-garment-reference-error" : "add-garment-reference-hint"
            }
            onChange={(event) => setReference(event.target.value)}
          />
          <FieldDescription id="add-garment-reference-hint">
            Only the number is read from a link. The link itself is never opened or sent anywhere.
          </FieldDescription>
          {refusal && <FieldError id="add-garment-reference-error">{refusals[refusal]}</FieldError>}
        </Field>
        <Button type="submit" variant="outline" className="min-h-11 w-fit">
          Add garment
        </Button>
      </form>
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {status}
      </p>
      {drafting !== null && (
        <section aria-labelledby="add-garment-draft-heading" className="flex flex-col gap-4 border-t pt-4">
          <h3
            id="add-garment-draft-heading"
            ref={heading}
            tabIndex={-1}
            className="font-condensed text-lg leading-tight font-semibold outline-none"
          >
            Set up blueprint {drafting}
          </h3>
          <p className="text-sm text-muted-foreground">
            Nothing is saved until you press Save garment. Name it yourself, or ask Printify what it calls this one.
          </p>
          {/* Keyed so a second number starts from empty fields instead of the first one's typing. */}
          <GarmentModelForm
            key={drafting}
            categories={categories}
            garment={{
              blueprintId: drafting,
              known: false,
              complete: false,
              manufacturer: null,
              model: null,
              categorySlug: null,
              googleProductCategory: null,
              gender: null,
              ageGroup: null,
              sizeSystem: null,
              productCount: 0,
              shownCount: 0,
              scheduledCount: 0,
            }}
            onSaved={setSavedDraft}
          />
          {/* Once saved there is nothing left to cancel; the refreshed list takes the garment over. */}
          <Button type="button" variant="ghost" className="min-h-11 w-fit" onClick={cancel}>
            {savedDraft === drafting ? "Close" : "Cancel"}
          </Button>
        </section>
      )}
    </section>
  )
}
