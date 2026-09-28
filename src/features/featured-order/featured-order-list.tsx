"use client"

import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type DragEndEvent,
  type CollisionDetection,
  type Announcements,
} from "@dnd-kit/core"
import { arrayMove } from "@dnd-kit/sortable"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import type { ProductScheduleEntry, ProductScheduleReceipt } from "@/features/publishing/product-schedule-entry"
import { listCadenceSlots } from "@/features/publishing/list-cadence-slots"
import { resolveProductWeek } from "@/features/publishing/resolve-product-week"
import { hasRevealArrived } from "@/features/publishing/has-reveal-arrived"
import { formatStoreMoment } from "@/lib/format-store-moment"

import type { FeaturedOrderProduct } from "./featured-order-product"
import { FeaturedOrderRow } from "./featured-order-row"
import { SortableProductSection } from "./sortable-product-section"
import { FeaturedProductContent } from "./featured-product-content"
import { WeeklyProductSchedule } from "./weekly-product-schedule"
import { ProductScheduleDialog, type ProductScheduleSlot } from "./product-schedule-dialog"
import { isProductNewOnTheWall } from "./is-product-new-on-the-wall"
import { isProductOnTheWall } from "./is-product-on-the-wall"
import { productDragCoordinates } from "./product-drag-coordinates"

/**
 * The page and mutation receipts supply the clock, so a release that arrives during a save is
 * reflected without a refresh that could discard another in-flight edit.
 *
 * `designOfWeekProductIds` is optional so every existing render site keeps working; membership is
 * explicit rather than inferred from "has a reveal date", because an ordinary scheduled tee is not
 * a Design of the Week and belongs in Hidden with its own note.
 */
type FeaturedOrderListProps = {
  products: FeaturedOrderProduct[]
  now: number
  designOfWeekProductIds?: string[]
  schedule?: { entries: ProductScheduleEntry[]; slots: ProductScheduleSlot[] }
}

/** What a drag picked up: a shop row, a hidden row, or a product card already queued for a week. */
type DragKind = "lineup" | "hidden" | "scheduled"

/**
 * A hidden product keeps its slot in the saved lineup, so restoring it puts it back where it was
 * rather than at the end. That is why the whole lineup stays in one array here and hiding never
 * sends a reorder.
 */

function describeVisibility(product: FeaturedOrderProduct, now: number) {
  if (product.revealAt !== null && !hasRevealArrived({ revealAt: product.revealAt }, now))
    return `Reveals ${formatStoreMoment(product.revealAt, { dateStyle: "medium", timeStyle: "short" })}`
  if (product.revealedAt === null) return "Never shown"
  return `Hidden since ${formatStoreMoment(product.hiddenAt!, { dateStyle: "medium" })}`
}

export function FeaturedOrderList({
  products: initialProducts,
  now: initialNow,
  designOfWeekProductIds = [],
  schedule,
}: FeaturedOrderListProps) {
  const router = useRouter()
  const [now, setNow] = useState(initialNow)
  const [entries, setEntries] = useState(schedule?.entries ?? [])
  const slots =
    now === initialNow
      ? (schedule?.slots ?? [])
      : listCadenceSlots({ from: new Date(now), count: 6 }).map((date) => ({
          value: date.toISOString(),
          label: formatStoreMoment(date.toISOString(), { weekday: "long", month: "long", day: "numeric" }),
        }))
  const [picker, setPicker] = useState<{
    product?: FeaturedOrderProduct
    week?: string
    returnFocus: HTMLElement | null
  } | null>(null)
  const focusAfterPicker = useRef<typeof picker>(null)
  const [activeDrag, setActiveDrag] = useState<{ id: string; kind: DragKind; width: number } | null>(null)
  const futureEntries = entries.filter((entry) => Date.parse(entry.liveAt) > now)
  const futureDates = new Map(futureEntries.map((entry) => [entry.productId, entry.liveAt]))
  const scheduledDates = new Map(
    futureEntries.map((entry) => [
      entry.productId,
      `Featured ${formatStoreMoment(entry.liveAt, { dateStyle: "medium" })}`,
    ])
  )
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: productDragCoordinates })
  )
  const collisionDetection: CollisionDetection = (args) => {
    const { kind, schedulable } = (args.active.data.current ?? {}) as { kind?: DragKind; schedulable?: boolean }
    const sortable = kind === "lineup" || kind === "hidden"
    // A row sorts only among its own section's rows. Every drag may choose a week, except the one
    // hidden tee the server would refuse to schedule, which is offered no week at all.
    const containers = args.droppableContainers.filter((container) => {
      const target = container.data.current?.kind
      return target === "week" ? schedulable !== false : sortable && target === kind
    })
    const scoped = { ...args, droppableContainers: containers }
    const rows = { ...args, droppableContainers: containers.filter((c) => c.data.current?.kind !== "week") }
    if (args.pointerCoordinates) {
      const pointer = pointerWithin(scoped)
      // A gap between rows still reorders; only an intentional hit can choose a week.
      return pointer.length || !sortable ? pointer : closestCenter(rows)
    }
    // Arrow keys sort a row among its neighbours; the Actions menu is its keyboard route to a week.
    // A queued product initially intersects only its own week, so picking it up and dropping it
    // leaves it there.
    return sortable ? closestCenter(rows) : rectIntersection(scoped)
  }
  function openPicker(product?: FeaturedOrderProduct, week?: string, source: "lineup" | "schedule" = "lineup") {
    const selector = source === "schedule" ? "[data-schedule-actions]" : "[data-visibility-toggle]"
    setPicker({
      product,
      week: week ?? (product ? futureDates.get(product.id) : undefined),
      returnFocus: product
        ? (Array.from(document.querySelectorAll<HTMLElement>(selector)).find(
            (button) =>
              (source === "schedule" ? button.dataset.scheduleActions : button.dataset.visibilityToggle) === product.id
          ) ?? null)
        : document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null,
    })
  }

  function closePicker() {
    focusAfterPicker.current = picker
    setPicker(null)
  }

  useEffect(() => {
    if (picker) return
    const closed = focusAfterPicker.current
    focusAfterPicker.current = null
    if (!closed?.product || !closed.returnFocus) return
    // An animation frame may run before React replaces the card and removes the dialog. Restore
    // focus after that commit, unless the dialog already restored it or the owner moved elsewhere.
    if (closed.returnFocus.isConnected || (document.activeElement && document.activeElement !== document.body)) return
    const controls = Array.from(
      document.querySelectorAll<HTMLElement>("[data-schedule-actions], [data-visibility-toggle]")
    )
    const scheduledTrigger = controls.find((button) => button.dataset.scheduleActions === closed.product!.id)
    const lineupTrigger = controls.find((button) => button.dataset.visibilityToggle === closed.product!.id)
    const target = closed.returnFocus.dataset.scheduleActions
      ? (scheduledTrigger ?? lineupTrigger)
      : (lineupTrigger ?? scheduledTrigger)
    target?.focus({ preventScroll: true })
  }, [picker])
  const [products, setProducts] = useState(initialProducts)
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle")
  const [saveNote, setSaveNote] = useState<string | null>(null)
  const [error, setError] = useState<{ message: string; reload: boolean; garments?: boolean } | null>(null)
  const [moveMessage, setMoveMessage] = useState("")
  const [pending, setPending] = useState<string[]>([])
  const mutating = useRef(new Set<string>())
  // Order and visibility revert independently, so a failed hide cannot undo a saved reorder.
  const confirmed = useRef(initialProducts)
  const queued = useRef<FeaturedOrderProduct[] | null>(null)
  const saving = useRef(false)
  const focusAfterToggle = useRef<string | null>(null)
  const lists = useRef<HTMLDivElement>(null)

  // Three lists, one array. Reordering within any of them permutes the single lineup, so a product
  // keeps its slot relative to everything it did not step over -- which is what lets a hidden tee,
  // or one whose drop has ended, come back exactly where it was.
  const drop = new Set(schedule ? (resolveProductWeek(entries, now)?.productIds ?? []) : designOfWeekProductIds)
  const designOfWeek = products.filter((product) => drop.has(product.id) && isProductOnTheWall(product, now))
  const available = products.filter((product) => !drop.has(product.id) && isProductOnTheWall(product, now))
  const hidden = products.filter((product) => !isProductOnTheWall(product, now))
  const newIds = new Set(products.filter((product) => isProductNewOnTheWall(product, now)).map(({ id }) => id))

  // Which of the three lists a product is in: a drag sorts, and an announcement counts, within it.
  function sectionOf(id: string | undefined) {
    if (hidden.some((item) => item.id === id)) return hidden
    return designOfWeek.some((item) => item.id === id) ? designOfWeek : available
  }

  function describeHidden(product: FeaturedOrderProduct) {
    return futureDates.has(product.id) && product.revealAt !== futureDates.get(product.id)
      ? `${scheduledDates.get(product.id)} · Hidden until shown or rescheduled`
      : (scheduledDates.get(product.id) ?? describeVisibility(product, now))
  }

  // The overlay copy of a row shows exactly what its section does: the same rank, note and menu.
  function rowProps(product: FeaturedOrderProduct) {
    const section = sectionOf(product.id)
    const hiddenRow = section === hidden
    return {
      product,
      hidden: hiddenRow,
      index: section.findIndex((item) => item.id === product.id),
      count: section.length,
      note: hiddenRow ? describeHidden(product) : scheduledDates.get(product.id),
      scheduled: scheduledDates.has(product.id),
      isNew: newIds.has(product.id),
    }
  }

  useEffect(() => {
    const id = focusAfterToggle.current
    // Hiding or showing moves the row to the other list, which destroys the focused button, and its
    // replacement stays disabled until the request settles. Wait for that, then hand focus back,
    // unless the owner has already moved on to something else.
    if (!id || pending.includes(id)) return
    focusAfterToggle.current = null
    if (document.activeElement && document.activeElement !== document.body) return
    const toggle = Array.from(
      lists.current?.querySelectorAll<HTMLButtonElement>("[data-visibility-toggle]") ?? []
    ).find((button) => button.dataset.visibilityToggle === id)
    toggle?.focus()
  }, [pending, products])

  function takeQueued() {
    const next = queued.current
    queued.current = null
    return next
  }

  async function save(order: FeaturedOrderProduct[]) {
    setSaveNote(null)
    queued.current = order
    // A request is already running; it picks up the newest order when it finishes.
    if (saving.current) return
    saving.current = true
    setSaveState("saving")
    setError(null)
    let failedStatus: number | null = null
    try {
      for (let next = takeQueued(); next; next = takeQueued()) {
        const response = await fetch("/api/admin/products/featured-order", {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productIds: next.map((product) => product.id) }),
        })
        if (!response.ok) {
          failedStatus = response.status
          break
        }
        confirmed.current = next
      }
    } catch {
      failedStatus = 0
    }
    saving.current = false
    if (failedStatus === null) {
      setSaveState("saved")
      return
    }
    queued.current = null
    // Restore the saved order while keeping whatever visibility the server has already accepted.
    setProducts((current) =>
      confirmed.current.map((product) => current.find((entry) => entry.id === product.id) ?? product)
    )
    setSaveState("idle")
    setError(
      failedStatus === 409
        ? {
            message: "The product list changed while you were sorting. Reload to sort the latest lineup.",
            reload: true,
          }
        : failedStatus === 401 || failedStatus === 403
          ? { message: "Your session has ended. Sign in again, then make that move again.", reload: false }
          : { message: "That move didn't save, so the last saved order is back in place. Try it again.", reload: false }
    )
  }

  /**
   * Move a row within its own section, expressed as a permutation of the single lineup.
   *
   * Each section hands back its own array, so a row only ever steps over its own neighbours and
   * everything else keeps its relative slot. The whole lineup is still what gets saved, because the
   * reorder route checks the exact active set and would 409 on anything less.
   */
  function moveWithinSection(section: FeaturedOrderProduct[], from: number, to: number) {
    const product = section[from]
    const target = section[to]
    if (!product || !target || from === to) return
    const next = arrayMove(
      products,
      products.findIndex((entry) => entry.id === product.id),
      products.findIndex((entry) => entry.id === target.id)
    )
    setProducts(next)
    setMoveMessage(`${product.title} moved to position ${to + 1} of ${section.length}.`)
    void save(next)
  }

  async function setHidden(product: FeaturedOrderProduct, hidden: boolean) {
    if (!startProductMutation([product.id])) return
    const previous = products
    const stamp = new Date().toISOString()
    focusAfterToggle.current = product.id
    setError(null)
    setProducts((current) =>
      current.map((entry) =>
        entry.id === product.id
          ? {
              ...entry,
              hiddenAt: hidden ? stamp : null,
              revealAt: hidden && !entry.garmentSetup ? (futureDates.get(product.id) ?? null) : null,
              revealedAt: hidden ? entry.revealedAt : (entry.revealedAt ?? stamp),
              // Show is only offered off the wall, so it is always an arrival. The response
              // corrects this to the server's own clock, or to a reveal that beat the click.
              addedToShopAt: hidden ? entry.addedToShopAt : stamp,
            }
          : entry
      )
    )
    setMoveMessage(`${product.title} moved to ${hidden ? "Hidden products" : "Available products"}.`)
    let ok = false
    try {
      const response = await fetch(`/api/admin/products/${encodeURIComponent(product.id)}/visibility`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden }),
      })
      ok = response.ok
      if (ok) {
        const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
        if (
          body &&
          ["hiddenAt", "revealAt", "revealedAt"].every((key) => body[key] === null || typeof body[key] === "string")
        ) {
          setProducts((current) =>
            current.map((entry) =>
              entry.id === product.id
                ? {
                    ...entry,
                    hiddenAt: body.hiddenAt as string | null,
                    revealAt: body.revealAt as string | null,
                    revealedAt: body.revealedAt as string | null,
                    // Optional, so a response from the release before this field still settles the
                    // row; the optimistic value stands until the next load.
                    ...(body.addedToShopAt === null || typeof body.addedToShopAt === "string"
                      ? { addedToShopAt: body.addedToShopAt }
                      : {}),
                  }
                : entry
            )
          )
        }
      } else if (response.status === 401 || response.status === 403)
        setError({ message: "Your session has ended. Sign in again, then try that again.", reload: false })
      else if (response.status === 409) {
        // The one refusal "try again" cannot fix: the garment needs setup first. The body is read on
        // this status only, and the server's sentence is shown as written because it says what to do.
        // A page that already knows disables Show instead; this is for a stale page or a race.
        const body = (await response.json().catch(() => null)) as { error?: unknown } | null
        setError({
          message:
            typeof body?.error === "string"
              ? body.error
              : "This product's garment still needs setup before it can be shown.",
          reload: false,
          garments: true,
        })
      } else if (!ok)
        setError({
          message: `That product is still ${hidden ? "in the shop" : "hidden"}. Try again in a moment.`,
          reload: response.status === 404,
        })
    } catch {
      setError({ message: "That change didn't save. Check your connection and try again.", reload: false })
    }
    finishProductMutation([product.id])
    // Revert only this row; a reorder saved while the request was in flight has to survive.
    if (ok) {
      setSaveState("saved")
      return
    }
    setProducts((current) => current.map((entry) => revertOne(entry, previous, product.id)))
    // Nothing saved, so neither the status line nor the announcement may go on saying it did.
    setSaveState("idle")
    setMoveMessage(`${product.title} is still ${hidden ? "in the shop" : "hidden"}.`)
  }

  async function saveSchedule(ids: string[], liveAt: string): Promise<string | null> {
    if (!startProductMutation(ids)) return "A selected product is still saving. Wait a moment, then try again."
    setError(null)
    try {
      const response = await fetch("/api/admin/product-schedule", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: ids, liveAt }),
      })
      const body = (await response.json().catch(() => null)) as
        | (Partial<ProductScheduleReceipt> & {
            error?: string
          })
        | null
      if (!response.ok) return body?.error ?? "That schedule did not save. Try again shortly."
      if (!applyScheduleReceipt(ids, body)) {
        return "The schedule was saved, but its confirmation could not be read. Reload products before making another change."
      }
      setMoveMessage(
        `${ids.length} ${ids.length === 1 ? "product" : "products"} scheduled for ${formatStoreMoment(liveAt, { dateStyle: "long" })}.`
      )
      setSaveState("saved")
      return null
    } catch {
      return "That change could not be confirmed. Reload products before trying again."
    } finally {
      finishProductMutation(ids)
    }
  }

  async function removeSchedule(product: FeaturedOrderProduct) {
    if (!startProductMutation([product.id])) return
    focusAfterToggle.current = product.id
    setError(null)
    try {
      const response = await fetch("/api/admin/product-schedule", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id }),
      })
      const body = (await response.json().catch(() => null)) as
        | (Partial<ProductScheduleReceipt> & {
            error?: string
            outcome?: "removed" | "current" | "unscheduled"
          })
        | null
      if (!response.ok) {
        setError({
          message: body?.error ?? "That product could not be removed from its week. Try again.",
          reload: true,
        })
        return
      }
      if (!applyScheduleReceipt([product.id], body)) {
        setError({ message: "The change could not be confirmed. Reload products before trying again.", reload: true })
        return
      }
      if (body?.outcome === "current") {
        setSaveState("idle")
        setSaveNote("That week has started; the product stays featured.")
        return
      }
      setMoveMessage(`${product.title} was removed from the schedule. Shop visibility is unchanged.`)
      setSaveState("saved")
    } catch {
      setError({ message: "That change could not be confirmed. Reload products before trying again.", reload: true })
    } finally {
      finishProductMutation([product.id])
    }
  }

  function applyScheduleReceipt(ids: string[], body: Partial<ProductScheduleReceipt> | null) {
    if (!body || !Array.isArray(body.entries) || !Array.isArray(body.products) || !Number.isFinite(body.now))
      return false
    const receipt = body as ProductScheduleReceipt
    setNow((current) => Math.max(current, receipt.now))
    setEntries((current) => [...current.filter((entry) => !ids.includes(entry.productId)), ...receipt.entries])
    setProducts((current) =>
      current.map((product) => {
        const visibility = receipt.products.find((entry) => entry.productId === product.id)
        return visibility
          ? {
              ...product,
              hiddenAt: visibility.hiddenAt,
              revealAt: visibility.revealAt,
              revealedAt: visibility.revealedAt,
            }
          : product
      })
    )
    return true
  }

  function startProductMutation(ids: string[]) {
    if (ids.some((id) => mutating.current.has(id))) return false
    setSaveNote(null)
    for (const id of ids) mutating.current.add(id)
    setPending([...mutating.current])
    return true
  }

  function finishProductMutation(ids: string[]) {
    for (const id of ids) mutating.current.delete(id)
    setPending([...mutating.current])
  }

  function dragEnd({ active, over }: DragEndEvent) {
    setActiveDrag(null)
    const { kind, productId: id } = (active.data.current ?? {}) as { kind?: DragKind; productId?: string }
    const product = products.find((item) => item.id === id)
    if (!product || !over) return
    if (over.data.current?.kind === "week" && schedule && (!product.garmentSetup || isProductOnTheWall(product, now))) {
      const liveAt = String(over.data.current.liveAt)
      if (futureDates.get(product.id) === liveAt) return
      void saveSchedule([product.id], liveAt).then((message) => {
        if (message) setError({ message, reload: true })
      })
    } else if ((kind === "lineup" || kind === "hidden") && over.data.current?.kind === kind) {
      const section = sectionOf(id)
      moveWithinSection(
        section,
        section.findIndex((item) => item.id === id),
        section.findIndex((item) => item.id === over.data.current?.productId)
      )
    }
  }

  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      const product = products.find((item) => item.id === active.data.current?.productId)
      if (active.data.current?.kind === "scheduled")
        return `Picked up ${product?.title}. Use arrow keys to choose a featured week, or Escape to cancel.`
      const section = sectionOf(product?.id)
      return `Picked up ${product?.title}. It is in position ${section.findIndex((item) => item.id === product?.id) + 1} of ${section.length}.`
    },
    onDragOver: ({ active, over }) => {
      if (!over) return undefined
      const id = active.data.current?.productId as string | undefined
      const title = products.find((item) => item.id === id)?.title
      if (over.data.current?.kind === "week")
        return `${title} is over the week of ${formatStoreMoment(String(over.data.current.liveAt), { dateStyle: "long" })}.`
      const section = sectionOf(id)
      const position = section.findIndex((item) => item.id === over.data.current?.productId) + 1
      return position ? `${title} is over position ${position} of ${section.length}.` : undefined
    },
    onDragEnd: ({ active, over }) => {
      const unchanged =
        !over ||
        active.id === over.id ||
        (over.data.current?.kind === "week" &&
          futureDates.get(String(active.data.current?.productId)) === over.data.current.liveAt)
      return `${products.find((item) => item.id === active.data.current?.productId)?.title} ${unchanged ? "was not moved." : "dropped. Saving the change."}`
    },
    onDragCancel: () => "Move cancelled. The product stayed in place.",
  }

  const dragged = activeDrag && products.find((item) => item.id === activeDrag.id)
  return (
    <DndContext
      id="product-lineup"
      sensors={sensors}
      collisionDetection={collisionDetection}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            "To pick up a product, press Space or Enter. Use the arrow keys to move it, then press Space or Enter to drop it, or Escape to cancel. The Actions menu also lets you choose a week or change the shop order.",
        },
      }}
      onDragStart={({ active, activatorEvent }) => {
        const { kind, productId } = (active.data.current ?? {}) as { kind?: DragKind; productId?: string }
        const row = activatorEvent.target instanceof Element ? activatorEvent.target.closest("li") : null
        if (kind && productId)
          setActiveDrag({
            id: productId,
            kind,
            width: active.rect.current.initial?.width ?? row?.getBoundingClientRect().width ?? 320,
          })
      }}
      onDragCancel={() => setActiveDrag(null)}
      onDragEnd={dragEnd}
    >
      <div ref={lists} className="flex flex-col gap-4">
        {schedule && (
          <WeeklyProductSchedule
            now={now}
            products={products}
            slots={slots}
            entries={futureEntries}
            busyIds={pending}
            onAdd={(week) => openPicker(undefined, week)}
            onChange={(product) => openPicker(product, undefined, "schedule")}
            onRemove={(product) => void removeSchedule(product)}
          />
        )}
        <div className="flex min-h-6 flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <p>Changes save as soon as you make them.</p>
          <p role="status" aria-live="polite">
            {saveNote ?? (saveState === "saving" ? "Saving…" : saveState === "saved" ? "Changes saved." : "")}
          </p>
        </div>
        <p className="sr-only" aria-live="polite">
          {moveMessage}
        </p>
        {error && (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-wrap items-center gap-3">
              {error.message}
              {error.garments && (
                <Link
                  href="/admin/products/garments"
                  className="inline-flex min-h-11 items-center underline underline-offset-4"
                >
                  Set up the garment
                </Link>
              )}
              {error.reload && (
                <Button variant="outline" className="min-h-11" onClick={() => router.refresh()}>
                  Reload products
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}

        {designOfWeek.length > 0 && (
          <section aria-labelledby="design-of-the-week-heading" className="flex flex-col gap-3">
            <h2 id="design-of-the-week-heading" className="font-condensed text-xl font-bold tracking-wide uppercase">
              This week
            </h2>
            <p className="text-sm text-muted-foreground">
              This week&rsquo;s products appear first in the shop. They stay for sale when the next week begins.
            </p>
            <SortableProductSection
              label="Design of the Week products"
              products={designOfWeek}
              busyIds={pending}
              onToggleHidden={(product) => setHidden(product, true)}
              onMove={moveWithinSection}
              onSchedule={schedule ? (product) => openPicker(product) : undefined}
              scheduledDates={scheduledDates}
              newIds={newIds}
            />
          </section>
        )}

        {products.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>No published products yet</EmptyTitle>
              <EmptyDescription>
                Publish a product in Printify to preview it here and plan its featured week.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <section aria-labelledby="available-products-heading" className="flex flex-col gap-3">
              <h2 id="available-products-heading" className="font-condensed text-xl font-bold tracking-wide uppercase">
                In the shop
              </h2>
              {available.length ? (
                <SortableProductSection
                  label="Available products"
                  products={available}
                  busyIds={pending}
                  onToggleHidden={(product) => setHidden(product, true)}
                  onMove={moveWithinSection}
                  onSchedule={schedule ? (product) => openPicker(product) : undefined}
                  scheduledDates={scheduledDates}
                  newIds={newIds}
                />
              ) : (
                <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  Nothing is in the shop right now. Show a product below to add it to the shop.
                </p>
              )}
            </section>

            {/* Rendered even when empty, so the section does not appear and vanish under the owner. */}
            <section aria-labelledby="hidden-products-heading" className="mt-4 flex flex-col gap-3">
              <h2 id="hidden-products-heading" className="font-condensed text-xl font-bold tracking-wide uppercase">
                Hidden from the shop
              </h2>
              <p className="text-sm text-muted-foreground">
                Still published at Printify, kept off the site until you show them. Each one keeps its place in the
                lineup; drag to change it.
              </p>
              {hidden.length ? (
                <SortableProductSection
                  label="Hidden products"
                  hidden
                  products={hidden}
                  busyIds={pending}
                  scheduledDates={scheduledDates}
                  describe={describeHidden}
                  onToggleHidden={(product) => setHidden(product, false)}
                  onMove={moveWithinSection}
                  onSchedule={schedule ? (product) => openPicker(product) : undefined}
                />
              ) : (
                <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  Nothing is hidden. Every published tee is in the shop.
                </p>
              )}
            </section>
          </>
        )}
      </div>
      <DragOverlay adjustScale={false} dropAnimation={{ duration: 180, easing: "ease-out" }}>
        {activeDrag && dragged && (
          // Inert as well as hidden from assistive tech: a row's copy carries real links and buttons.
          <div
            aria-hidden="true"
            inert
            data-product-drag-overlay
            className="pointer-events-none"
            style={{ width: activeDrag.width }}
          >
            {activeDrag.kind === "scheduled" ? (
              <div className="flex items-center gap-4 rounded-lg border bg-background p-3 shadow-2xl ring-1 ring-border">
                <FeaturedProductContent product={dragged} interactive={false} isNew={newIds.has(dragged.id)} />
              </div>
            ) : (
              <FeaturedOrderRow overlay {...rowProps(dragged)} />
            )}
          </div>
        )}
      </DragOverlay>
      {picker && schedule && (
        <ProductScheduleDialog
          now={now}
          key={`${picker.product?.id ?? "many"}:${picker.week ?? "next"}`}
          product={picker.product}
          initialWeek={picker.week}
          products={products}
          slots={slots}
          entries={futureEntries}
          busyIds={pending}
          onClose={closePicker}
          onSave={saveSchedule}
          returnFocus={picker.returnFocus}
        />
      )}
    </DndContext>
  )
}

function revertOne(entry: FeaturedOrderProduct, previous: FeaturedOrderProduct[], id: string) {
  return entry.id === id ? (previous.find((product) => product.id === id) ?? entry) : entry
}
