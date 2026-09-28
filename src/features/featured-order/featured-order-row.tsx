"use client"

import type { DraggableAttributes, DraggableSyntheticListeners } from "@dnd-kit/core"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { GripVertical } from "lucide-react"

import { cn } from "@/lib/cn"

import type { FeaturedOrderProduct } from "./featured-order-product"
import { FeaturedProductContent } from "./featured-product-content"
import { ProductActionsMenu } from "./product-actions-menu"

export type Direction = "up" | "down"
export type FeaturedOrderRowProps = {
  product: FeaturedOrderProduct
  index?: number
  count?: number
  /** Off the wall: the row previews privately, sorts among the other hidden rows, and can still be dragged into a week. */
  hidden?: boolean
  busy?: boolean
  note?: string
  scheduled?: boolean
  /** In the shop and arrived in the last two weeks: the thumbnail carries the shop's New badge. */
  isNew?: boolean
  /**
   * The still copy that follows the pointer. It is the same row, minus the sortable hook that would
   * register a second draggable under the original's id, and it renders no list item because the
   * overlay is not a list. The overlay is inert, so nothing in the copy can be used.
   */
  overlay?: boolean
  onMove?: (direction: Direction) => void
  onToggleHidden?: () => void
  onSchedule?: () => void
}

type Handle = {
  ref: (element: HTMLElement | null) => void
  attributes: DraggableAttributes
  listeners: DraggableSyntheticListeners
}

const rowClassName = "flex flex-wrap items-center gap-2 rounded-lg border bg-background p-2 sm:gap-4 sm:p-3"

export function FeaturedOrderRow(props: FeaturedOrderRowProps) {
  return props.overlay ? <OverlayRow {...props} /> : <SortableRow {...props} />
}

function SortableRow(props: FeaturedOrderRowProps) {
  const { product, hidden, busy } = props
  const kind = hidden ? "hidden" : "lineup"
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: `${kind}:${product.id}`,
    disabled: busy,
    // A hidden tee on an unfinished garment still sorts, but the server would refuse to schedule
    // it, so its drag is offered no week to land in.
    data: { kind, productId: product.id, schedulable: !hidden || !product.garmentSetup },
  })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(rowClassName, isDragging && "opacity-30")}
    >
      <RowParts {...props} handle={{ ref: setActivatorNodeRef, attributes, listeners }} />
    </li>
  )
}

function OverlayRow(props: FeaturedOrderRowProps) {
  return (
    <div className={cn(rowClassName, "shadow-2xl ring-1 ring-border")}>
      <RowParts {...props} />
    </div>
  )
}

function RowParts({ handle, ...props }: FeaturedOrderRowProps & { handle?: Handle }) {
  const { product, hidden = false, index, note, busy, isNew } = props
  return (
    <>
      <button
        ref={handle?.ref}
        type="button"
        aria-label={`Reorder ${product.title}`}
        disabled={busy}
        className="flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-muted-foreground hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing"
        {...handle?.attributes}
        {...handle?.listeners}
      >
        <GripVertical aria-hidden="true" className="size-5" />
      </button>
      {!hidden && (
        <span
          aria-hidden="true"
          className="hidden w-5 shrink-0 text-center text-sm text-muted-foreground tabular-nums sm:block"
        >
          {(index ?? 0) + 1}
        </span>
      )}
      <FeaturedProductContent product={product} hidden={hidden} note={note} isNew={isNew} />
      <div className="ml-auto">
        <ProductActionsMenu {...props} hidden={hidden} />
      </div>
    </>
  )
}
