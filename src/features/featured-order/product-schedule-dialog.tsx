"use client"

import { useState } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import type { ProductScheduleEntry } from "@/features/publishing/product-schedule-entry"
import { formatStoreMoment } from "@/lib/format-store-moment"

import { isProductOnTheWall } from "./is-product-on-the-wall"
import type { FeaturedOrderProduct } from "./featured-order-product"

export type ProductScheduleSlot = { value: string; label: string }

export function ProductScheduleDialog({
  product,
  now,
  initialWeek,
  products,
  slots,
  entries,
  busyIds,
  onClose,
  onSave,
  returnFocus,
}: {
  product?: FeaturedOrderProduct
  now: number
  initialWeek?: string
  products: FeaturedOrderProduct[]
  slots: ProductScheduleSlot[]
  entries: ProductScheduleEntry[]
  busyIds: string[]
  onClose: () => void
  onSave: (ids: string[], liveAt: string) => Promise<string | null>
  returnFocus: HTMLElement | null
}) {
  const [week, setWeek] = useState(
    slots.some((slot) => slot.value === initialWeek) ? initialWeek! : (slots[0]?.value ?? "")
  )
  const [selected, setSelected] = useState<string[]>(product ? [product.id] : [])
  const [query, setQuery] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const currentDates = new Map(entries.map((entry) => [entry.productId, entry.liveAt]))
  const matching = products.filter((item) => item.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()))

  async function save() {
    if (pending || !week || !selected.length || selected.some((id) => busyIds.includes(id))) return
    setPending(true)
    setError(null)
    const error = await onSave(selected, week)
    setPending(false)
    if (error) setError(error)
    else onClose()
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl"
        finalFocus={() => {
          if (returnFocus?.isConnected) return returnFocus
          // Moving a scheduled card replaces its old trigger with one under the new date.
          return product
            ? (Array.from(
                document.querySelectorAll<HTMLElement>("[data-schedule-actions], [data-visibility-toggle]")
              ).find(
                (button) =>
                  button.dataset.scheduleActions === product.id || button.dataset.visibilityToggle === product.id
              ) ?? false)
            : false
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {product
              ? currentDates.has(product.id)
                ? "Change featured week"
                : "Add to Design of the week"
              : "Add products to this week"}
          </DialogTitle>
          <DialogDescription>
            {product
              ? product.title
              : "Choose published products to feature together. Products already in the shop stay visible."}
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="product-feature-week">Featured week</FieldLabel>
          <NativeSelect
            id="product-feature-week"
            className="w-full [&_select]:min-h-11"
            value={week}
            disabled={pending}
            onChange={(event) => {
              setWeek(event.target.value)
              setSelected(product ? [product.id] : [])
              setError(null)
            }}
          >
            {slots.map((slot) => (
              <option key={slot.value} value={slot.value}>
                {slot.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {!product && (
          <>
            <Field>
              <FieldLabel htmlFor="schedule-product-search">Search products</FieldLabel>
              <Input
                id="schedule-product-search"
                className="min-h-11"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find a product"
              />
            </Field>
            <fieldset className="flex max-h-72 flex-col gap-2 overflow-y-auto p-1">
              <legend className="sr-only">Products to feature</legend>
              {matching.map((item) => {
                const date = currentDates.get(item.id)
                const alreadyHere = date === week
                const blocked = Boolean(item.garmentSetup) && !isProductOnTheWall(item, now)
                const checked = selected.includes(item.id)
                return (
                  <label
                    key={item.id}
                    className="flex min-h-16 cursor-pointer items-start gap-3 rounded-md border p-3 has-checked:border-primary has-checked:bg-muted has-disabled:cursor-default has-disabled:opacity-65"
                  >
                    <input
                      type="checkbox"
                      className="mt-1 size-4 accent-primary"
                      checked={alreadyHere || checked}
                      disabled={pending || blocked || alreadyHere || busyIds.includes(item.id)}
                      onChange={(event) =>
                        setSelected((current) =>
                          event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id)
                        )
                      }
                    />
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="font-condensed text-lg leading-tight font-semibold">{item.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {busyIds.includes(item.id)
                          ? "Saving a change…"
                          : blocked
                            ? "Finish garment setup before scheduling"
                            : alreadyHere
                              ? "Already in this week"
                              : date
                                ? `Moves from ${formatStoreMoment(date, { dateStyle: "medium" })}`
                                : !isProductOnTheWall(item, now)
                                  ? "Hidden until this week starts"
                                  : "Already in the shop"}
                      </span>
                    </span>
                  </label>
                )
              })}
              {matching.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">No products match that name.</p>
              )}
            </fieldset>
          </>
        )}
        <p className="text-sm text-muted-foreground">
          Hidden products appear in the shop on Monday at 4 AM Central. Removing a product from a future week leaves its
          shop visibility unchanged. Products stay for sale after their featured week ends.
        </p>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" className="min-h-11" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="min-h-11"
            disabled={
              pending ||
              !week ||
              !selected.length ||
              selected.some((id) => busyIds.includes(id)) ||
              (Boolean(product?.garmentSetup) && !!product && !isProductOnTheWall(product, now))
            }
            onClick={() => void save()}
          >
            {pending
              ? "Saving…"
              : product
                ? "Save featured week"
                : `Add ${selected.length || ""} ${selected.length === 1 ? "product" : "products"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
