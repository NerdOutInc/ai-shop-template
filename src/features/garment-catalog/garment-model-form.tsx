"use client"

import { Search } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"

import type { AdminGarment, GarmentSetup, ShopCategory } from "./garment-catalog"
import { garmentDisplayName } from "./garment-display-name"
import { garmentProfileOptions } from "./garment-profile-options"

type GarmentModelFormProps = {
  garment: AdminGarment
  categories: ShopCategory[]
  /** Told after the server accepts a save, so whatever lists this garment can follow it if it moves. */
  onSaved?: (blueprintId: number) => void
}

// Every field is text while it is being edited. "" is "not chosen yet", which the route spells null.
type Values = Record<keyof GarmentSetup, string>
type FieldErrors = Partial<Record<"manufacturer" | "model" | "googleProductCategory", string>>

const labels = {
  genders: { male: "Male", female: "Female", unisex: "Unisex" },
  ageGroups: { newborn: "Newborn", infant: "Infant", toddler: "Toddler", kids: "Kids", adult: "Adult" },
} as const

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * One garment's setup: its name, its shop category and the apparel details the merchant feeds need.
 *
 * It never says whether the garment is complete. That is the database's answer (the generated
 * `complete` column), so a save refreshes the page and lets the list regroup from what the server
 * now reports. Clearing a field is allowed here and refused by the server while the garment's
 * products are in the shop or scheduled; that refusal is shown as the server wrote it, because it
 * names the number of products in the way.
 *
 * That regrouping remounts the form from what was saved, so the fields are held from the press of
 * Save until the refreshed list has rendered. A field that took typing in that window would lose
 * it without a word; refusing the typing is the honest version of the same outcome.
 */
export function GarmentModelForm({ garment, categories, onSaved }: GarmentModelFormProps) {
  const router = useRouter()
  const id = garment.blueprintId
  // Blueprint-scoped, because a page holds one of these forms per garment.
  const field = (name: string) => `garment-${id}-${name}`
  const name = garmentDisplayName(garment)
  const [values, setValues] = useState<Values>({
    manufacturer: garment.manufacturer ?? "",
    model: garment.model ?? "",
    categorySlug: garment.categorySlug ?? "",
    googleProductCategory: garment.googleProductCategory === null ? "" : String(garment.googleProductCategory),
    gender: garment.gender ?? "",
    ageGroup: garment.ageGroup ?? "",
    sizeSystem: garment.sizeSystem ?? "",
  })
  const [pending, setPending] = useState<"save" | "lookup" | null>(null)
  // router.refresh() returns at once. Inside a transition, React keeps `refreshing` true until the
  // tree the server sends back has committed, which is the moment this form is either gone (its
  // card changed lists) or safe to edit again.
  const [refreshing, startRefresh] = useTransition()
  const saving = pending === "save" || refreshing
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [error, setError] = useState<{ message: string; reload: boolean } | null>(null)
  const [status, setStatus] = useState("")
  const form = useRef<HTMLFormElement>(null)
  const pressed = useRef<HTMLElement | null>(null)
  // A refresh swaps the options under a form that keeps its state, so a category deleted in another
  // tab can outlive its option. The select would fall back to the placeholder while the save kept
  // sending the dead slug; resolving it once keeps what is shown and what is sent the same.
  const categorySlug = categories.some((category) => category.slug === values.categorySlug) ? values.categorySlug : ""

  // A pressed button is disabled while its request runs, and so is the field Enter was pressed in
  // while a save runs; a disabled control cannot keep focus. Hand it back once everything settles,
  // unless the owner has already moved on. A card that changed lists never gets here: this form
  // unmounts first, and the list sends focus to the card's new place.
  useEffect(() => {
    if (pending || refreshing) return
    const target = pressed.current
    pressed.current = null
    if (!target || (document.activeElement && document.activeElement !== document.body)) return
    target.focus()
  }, [pending, refreshing])

  function set(key: keyof Values, value: string) {
    setValues((current) => ({ ...current, [key]: value }))
  }

  function start(action: "save" | "lookup") {
    const active = document.activeElement
    pressed.current = active instanceof HTMLElement && form.current?.contains(active) ? active : null
    setPending(action)
    setError(null)
    setStatus("")
  }

  async function lookUp() {
    if (pending || refreshing) return
    start("lookup")
    try {
      // Only the number travels. The route builds Printify's address itself and sends back names.
      const response = await fetch(`/api/admin/products/garments/${id}/catalog`, { credentials: "same-origin" })
      const body = (await response.json().catch(() => null)) as {
        title?: unknown
        manufacturer?: unknown
        model?: unknown
        error?: string
      } | null
      if (!response.ok || !body) {
        setError({
          message:
            body?.error ??
            "Printify's catalog could not be read. Type the garment's name yourself, or try again shortly.",
          reload: false,
        })
        return
      }
      const found = {
        manufacturer: typeof body.manufacturer === "string" ? body.manufacturer.trim().slice(0, 80) : "",
        model: typeof body.model === "string" ? body.model.trim().slice(0, 80) : "",
      }
      // Only ever into an empty field: a name the owner typed is a decision, not a draft.
      const fills = (["manufacturer", "model"] as const).filter((key) => !values[key].trim() && found[key])
      setValues((current) => ({
        ...current,
        manufacturer: current.manufacturer.trim() ? current.manufacturer : found.manufacturer || current.manufacturer,
        model: current.model.trim() ? current.model : found.model || current.model,
      }))
      if (fills.length) setFieldErrors((current) => ({ ...current, manufacturer: undefined, model: undefined }))
      const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 120) : null
      const called = title ? `Printify calls this “${title}”` : "Printify knows this garment"
      setStatus(
        fills.length
          ? `${called}. The empty name fields are filled in: check them, then save.`
          : values.manufacturer.trim() && values.model.trim()
            ? `${called}. Your manufacturer and model were kept.`
            : `${called} but had nothing for the empty name fields. Type them yourself.`
      )
    } catch {
      setError({
        message: "Printify's catalog could not be read. Type the garment's name yourself, or try again shortly.",
        reload: false,
      })
    } finally {
      setPending(null)
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || refreshing) return
    const taxonomy = values.googleProductCategory.trim()
    const problems: FieldErrors = {
      manufacturer: values.manufacturer.trim() ? undefined : "Enter the manufacturer, such as Next Level.",
      model: values.model.trim() ? undefined : "Enter the model, such as 6210.",
      googleProductCategory:
        !taxonomy || /^[1-9]\d{0,5}$/.test(taxonomy)
          ? undefined
          : "Use the number from Google's product category list, such as 212.",
    }
    setFieldErrors(problems)
    const firstProblem = (["manufacturer", "model", "googleProductCategory"] as const).find((key) => problems[key])
    if (firstProblem) {
      // Nothing is sent. Land on the field that needs fixing instead of leaving the owner to hunt.
      setError(null)
      setStatus("")
      const inputs = { manufacturer: "manufacturer", model: "model", googleProductCategory: "google-category" }
      form.current?.querySelector<HTMLElement>(`#${field(inputs[firstProblem])}`)?.focus()
      return
    }
    const setup: GarmentSetup = {
      manufacturer: values.manufacturer.trim(),
      model: values.model.trim(),
      categorySlug: categorySlug || null,
      googleProductCategory: taxonomy ? Number(taxonomy) : null,
      gender: (values.gender || null) as GarmentSetup["gender"],
      ageGroup: (values.ageGroup || null) as GarmentSetup["ageGroup"],
      sizeSystem: (values.sizeSystem || null) as GarmentSetup["sizeSystem"],
    }
    start("save")
    try {
      const response = await fetch(`/api/admin/products/garments/${id}`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(setup),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        // Verbatim: the server's refusal counts the products in the way and says what to do first.
        setError({
          message: body?.error ?? "That garment didn't save. Try again in a moment.",
          // 404 is a category deleted in another tab; fresh options are the fix.
          reload: response.status === 404,
        })
        return
      }
      setStatus("Saved.")
      onSaved?.(id)
      startRefresh(() => router.refresh())
    } catch {
      setError({ message: "That change could not be confirmed. Refresh before trying again.", reload: false })
    } finally {
      setPending(null)
    }
  }

  const onTheWall = garment.shownCount + garment.scheduledCount
  return (
    <form
      ref={form}
      noValidate
      aria-label={`${name} setup`}
      aria-busy={saving}
      className="flex flex-col gap-4"
      onSubmit={save}
    >
      <p className="text-sm text-muted-foreground">
        {garment.productCount === 0
          ? "No published products use this garment yet."
          : `${plural(garment.productCount, "published product", "published products")}, ${garment.shownCount} shown${
              garment.scheduledCount ? `, ${garment.scheduledCount} scheduled` : ""
            }.`}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={fieldErrors.manufacturer ? true : undefined}>
          <FieldLabel htmlFor={field("manufacturer")}>Manufacturer</FieldLabel>
          <Input
            id={field("manufacturer")}
            disabled={saving}
            value={values.manufacturer}
            maxLength={80}
            autoComplete="off"
            className="min-h-11"
            aria-invalid={fieldErrors.manufacturer ? true : undefined}
            aria-describedby={fieldErrors.manufacturer ? field("manufacturer-error") : undefined}
            onChange={(event) => set("manufacturer", event.target.value)}
          />
          {fieldErrors.manufacturer && (
            <FieldError id={field("manufacturer-error")}>{fieldErrors.manufacturer}</FieldError>
          )}
        </Field>
        <Field data-invalid={fieldErrors.model ? true : undefined}>
          <FieldLabel htmlFor={field("model")}>Model</FieldLabel>
          <Input
            id={field("model")}
            disabled={saving}
            value={values.model}
            maxLength={80}
            autoComplete="off"
            className="min-h-11"
            aria-invalid={fieldErrors.model ? true : undefined}
            aria-describedby={fieldErrors.model ? field("model-error") : undefined}
            onChange={(event) => set("model", event.target.value)}
          />
          {fieldErrors.model && <FieldError id={field("model-error")}>{fieldErrors.model}</FieldError>}
        </Field>
      </div>
      <div className="flex flex-col gap-1">
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-fit"
          disabled={pending !== null || refreshing}
          onClick={lookUp}
        >
          <Search data-icon="inline-start" aria-hidden="true" />
          {pending === "lookup" ? "Asking Printify…" : "Look up name from Printify"}
          <span className="sr-only">: {name}</span>
        </Button>
        <p className="text-sm text-muted-foreground">Fills in only the name fields you have left empty.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={field("category")}>Shop category</FieldLabel>
          <NativeSelect
            id={field("category")}
            disabled={saving}
            value={categorySlug}
            className="w-full [&_select]:min-h-11"
            aria-describedby={categories.length ? undefined : field("category-hint")}
            onChange={(event) => set("categorySlug", event.target.value)}
          >
            <NativeSelectOption value="">Choose a category</NativeSelectOption>
            {categories.map((category) => (
              <NativeSelectOption key={category.slug} value={category.slug}>
                {category.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {categories.length === 0 && (
            <FieldDescription id={field("category-hint")}>
              There are no categories yet. <Link href="/admin/products/categories">Add one under Categories</Link>, then
              come back.
            </FieldDescription>
          )}
        </Field>
        <Field data-invalid={fieldErrors.googleProductCategory ? true : undefined}>
          <FieldLabel htmlFor={field("google-category")}>Google product category</FieldLabel>
          <Input
            id={field("google-category")}
            disabled={saving}
            value={values.googleProductCategory}
            inputMode="numeric"
            maxLength={6}
            autoComplete="off"
            className="min-h-11"
            aria-invalid={fieldErrors.googleProductCategory ? true : undefined}
            aria-describedby={
              fieldErrors.googleProductCategory
                ? `${field("google-category-hint")} ${field("google-category-error")}`
                : field("google-category-hint")
            }
            onChange={(event) => set("googleProductCategory", event.target.value)}
          />
          <FieldDescription id={field("google-category-hint")}>
            The number from Google&rsquo;s product category list, which Meta shares. Shirts and tops are 212.
          </FieldDescription>
          {fieldErrors.googleProductCategory && (
            <FieldError id={field("google-category-error")}>{fieldErrors.googleProductCategory}</FieldError>
          )}
        </Field>
        <Field>
          <FieldLabel htmlFor={field("gender")}>Gender</FieldLabel>
          <NativeSelect
            id={field("gender")}
            disabled={saving}
            value={values.gender}
            className="w-full [&_select]:min-h-11"
            onChange={(event) => set("gender", event.target.value)}
          >
            <NativeSelectOption value="">Choose a gender</NativeSelectOption>
            {garmentProfileOptions.genders.map((gender) => (
              <NativeSelectOption key={gender} value={gender}>
                {labels.genders[gender]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor={field("age-group")}>Age group</FieldLabel>
          <NativeSelect
            id={field("age-group")}
            disabled={saving}
            value={values.ageGroup}
            className="w-full [&_select]:min-h-11"
            onChange={(event) => set("ageGroup", event.target.value)}
          >
            <NativeSelectOption value="">Choose an age group</NativeSelectOption>
            {garmentProfileOptions.ageGroups.map((ageGroup) => (
              <NativeSelectOption key={ageGroup} value={ageGroup}>
                {labels.ageGroups[ageGroup]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor={field("size-system")}>Size system</FieldLabel>
          <NativeSelect
            id={field("size-system")}
            disabled={saving}
            value={values.sizeSystem}
            className="w-full [&_select]:min-h-11"
            onChange={(event) => set("sizeSystem", event.target.value)}
          >
            <NativeSelectOption value="">Choose a size system</NativeSelectOption>
            {garmentProfileOptions.sizeSystems.map((sizeSystem) => (
              <NativeSelectOption key={sizeSystem} value={sizeSystem}>
                {sizeSystem}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      </div>
      {garment.complete && onTheWall > 0 && (
        <p className="text-sm text-muted-foreground">
          {plural(onTheWall, "product on this garment is", "products on this garment are")} in the shop or scheduled, so
          these details can be changed but not cleared. Hide {onTheWall === 1 ? "it" : "them"} first if you need to
          start over.
        </p>
      )}
      <Button type="submit" className="min-h-11 w-fit" disabled={pending !== null || refreshing}>
        {pending === "save" ? "Saving…" : refreshing ? "Updating…" : "Save garment"}
        <span className="sr-only">: {name}</span>
      </Button>
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {pending === "save"
          ? "Saving this garment’s setup…"
          : pending === "lookup"
            ? "Asking Printify for this garment’s name…"
            : refreshing
              ? "Saved. Updating the list…"
              : status}
      </p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center gap-3">
            {error.message}
            {error.reload && (
              <Button type="button" variant="outline" className="min-h-11" onClick={() => router.refresh()}>
                Reload garments
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
    </form>
  )
}
