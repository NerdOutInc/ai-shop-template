"use client"

import { useDraggable, useDroppable } from "@dnd-kit/core"
import { CalendarDays, GripVertical, MoreHorizontal, Plus, X } from "lucide-react"
import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { ProductScheduleEntry } from "@/features/publishing/product-schedule-entry"
import { cn } from "@/lib/cn"
import { formatWeeklyCadence } from "@/features/publishing/format-weekly-cadence"
import { formatStoreMoment } from "@/lib/format-store-moment"

import { isProductNewOnTheWall } from "./is-product-new-on-the-wall"
import { isProductOnTheWall } from "./is-product-on-the-wall"
import type { FeaturedOrderProduct } from "./featured-order-product"
import { FeaturedProductContent } from "./featured-product-content"
import type { ProductScheduleSlot } from "./product-schedule-dialog"

export function WeeklyProductSchedule({
  products,
  now,
  slots,
  entries,
  busyIds,
  onAdd,
  onChange,
  onRemove,
}: {
  products: FeaturedOrderProduct[]
  now: number
  slots: ProductScheduleSlot[]
  entries: ProductScheduleEntry[]
  busyIds: string[]
  onAdd: (week: string) => void
  onChange: (product: FeaturedOrderProduct) => void
  onRemove: (product: FeaturedOrderProduct) => void
}) {
  const otherDates = [...new Set(entries.map((entry) => entry.liveAt))]
    .filter((date) => !slots.some((slot) => slot.value === date))
    .sort()
  return (
    <section className="rounded-lg border" aria-labelledby="weekly-schedule-heading">
      <header className="flex flex-col gap-2 border-b p-4 sm:p-6">
        <h2 id="weekly-schedule-heading" className="font-condensed text-xl font-bold tracking-wide uppercase">
          Design of the Week
        </h2>
        <p className="text-sm text-muted-foreground">
          The next six weeks. Add products together, or drag a product into its week.
        </p>
        <p className="text-xs text-muted-foreground">
          Every {formatWeeklyCadence()}. Hidden products appear when their week begins.
        </p>
      </header>
      <div className="flex flex-col">
        {slots.map((slot, index) => (
          <Week
            key={slot.value}
            now={now}
            slot={slot}
            index={index}
            products={products.filter((product) =>
              entries.some((entry) => entry.productId === product.id && entry.liveAt === slot.value)
            )}
            busyIds={busyIds}
            onAdd={() => onAdd(slot.value)}
            onChange={onChange}
            onRemove={onRemove}
          />
        ))}
        {otherDates.length > 0 && (
          <div className="border-t">
            <header className="px-4 pt-5 sm:px-6">
              <h3 className="font-condensed text-lg font-semibold">Other scheduled dates</h3>
              <p className="text-sm text-muted-foreground">
                Existing releases outside these six dates keep their schedules. Move them to an upcoming week, or remove
                them.
              </p>
            </header>
            {otherDates.map((date) => (
              <Week
                key={date}
                now={now}
                index={-1}
                editable={false}
                slot={{ value: date, label: formatStoreMoment(date, { dateStyle: "long", timeStyle: "short" }) }}
                products={products.filter((product) =>
                  entries.some((entry) => entry.productId === product.id && entry.liveAt === date)
                )}
                busyIds={busyIds}
                onAdd={() => {}}
                onChange={onChange}
                onRemove={onRemove}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function Week({
  now,
  slot,
  index,
  editable = true,
  products,
  busyIds,
  onAdd,
  onChange,
  onRemove,
}: {
  slot: ProductScheduleSlot
  now: number
  index: number
  editable?: boolean
  products: FeaturedOrderProduct[]
  busyIds: string[]
  onAdd: () => void
  onChange: (product: FeaturedOrderProduct) => void
  onRemove: (product: FeaturedOrderProduct) => void
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `week:${slot.value}`,
    disabled: !editable,
    data: { kind: "week", liveAt: slot.value },
  })
  return (
    <section
      ref={setNodeRef}
      aria-label={`Week of ${slot.label}`}
      data-week-drop={editable ? slot.value : undefined}
      className={cn(
        "flex flex-col gap-3 border-b p-4 last:border-b-0 sm:p-6",
        isOver && "bg-muted ring-2 ring-ring ring-inset"
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="font-condensed text-lg font-semibold">{slot.label}</h3>
          {index === 0 && <Badge variant="secondary">Up next</Badge>}
        </div>
        <span className="text-xs text-muted-foreground">
          {products.length} {products.length === 1 ? "product" : "products"}
        </span>
      </div>
      {products.length > 0 && (
        <ul aria-label={`Products for ${slot.label}`} className="grid gap-2 lg:grid-cols-2">
          {products.map((product) => (
            <ScheduledProduct
              key={product.id}
              shown={isProductOnTheWall(product, now)}
              isNew={isProductNewOnTheWall(product, now)}
              product={product}
              liveAt={slot.value}
              busy={busyIds.includes(product.id)}
              onChange={() => onChange(product)}
              onRemove={() => onRemove(product)}
            />
          ))}
        </ul>
      )}
      {editable && (
        <Button variant="outline" className="min-h-12 justify-start border-dashed" onClick={onAdd}>
          <Plus aria-hidden="true" data-icon="inline-start" />
          {products.length ? "Add products" : "Add the first product"}
        </Button>
      )}
    </section>
  )
}

function ScheduledProduct({
  product,
  liveAt,
  shown,
  isNew,
  busy,
  onChange,
  onRemove,
}: {
  product: FeaturedOrderProduct
  liveAt: string
  shown: boolean
  isNew: boolean
  busy: boolean
  onChange: () => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: `scheduled:${product.id}`,
    disabled: busy,
    data: { kind: "scheduled", productId: product.id, liveAt },
  })
  return (
    <li
      ref={setNodeRef}
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-md border bg-background p-2",
        isDragging && "opacity-30"
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        aria-label={`Move ${product.title} to another week by dragging`}
        disabled={busy}
        className="flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-5" aria-hidden="true" />
      </button>
      <FeaturedProductContent
        product={product}
        hidden
        interactive={false}
        isNew={isNew}
        note={
          shown
            ? "Already in the shop"
            : product.garmentSetup
              ? "Hidden · Finish garment setup, then show or reschedule"
              : product.revealAt !== liveAt
                ? "Hidden · Show or reschedule to reveal"
                : "Hidden until this week"
        }
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-lg" className="ml-auto min-h-11 min-w-11" />}
          aria-label={`Scheduled actions for ${product.title}`}
          data-schedule-actions={product.id}
          disabled={busy}
        >
          <MoreHorizontal aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem render={<Link href={`/admin/products/${encodeURIComponent(product.id)}`} />}>
              Preview product
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onChange}>
              <CalendarDays aria-hidden="true" />
              Change week
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onRemove}>
              <X aria-hidden="true" />
              Remove from this week
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}
