"use client"

import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable"

import type { FeaturedOrderProduct } from "./featured-order-product"
import { FeaturedOrderRow } from "./featured-order-row"

export function SortableProductSection({
  label,
  products,
  hidden = false,
  busyIds,
  scheduledDates,
  newIds,
  describe,
  onToggleHidden,
  onMove,
  onSchedule,
}: {
  label: string
  products: FeaturedOrderProduct[]
  /** The Hidden list: its rows preview privately, and their menu shows rather than hides. */
  hidden?: boolean
  busyIds: string[]
  scheduledDates: Map<string, string>
  /** Rows that carry the shop's New badge. */
  newIds?: Set<string>
  /** The line under a title. Shop rows name their featured week; Hidden rows say why they are off the wall. */
  describe?: (product: FeaturedOrderProduct) => string | undefined
  onToggleHidden: (product: FeaturedOrderProduct) => void
  onMove: (products: FeaturedOrderProduct[], from: number, to: number) => void
  onSchedule?: (product: FeaturedOrderProduct) => void
}) {
  // The same id each row registers under, so a row's index is read off this list.
  const items = products.map((product) => `${hidden ? "hidden" : "lineup"}:${product.id}`)
  return (
    <SortableContext items={items} strategy={verticalListSortingStrategy}>
      <ol aria-label={label} className="flex flex-col gap-2">
        {products.map((product, index) => (
          <FeaturedOrderRow
            key={product.id}
            product={product}
            hidden={hidden}
            index={index}
            count={products.length}
            busy={busyIds.includes(product.id)}
            note={describe ? describe(product) : scheduledDates.get(product.id)}
            scheduled={scheduledDates.has(product.id)}
            isNew={newIds?.has(product.id)}
            onMove={(direction) => onMove(products, index, index + (direction === "up" ? -1 : 1))}
            onToggleHidden={() => onToggleHidden(product)}
            onSchedule={onSchedule ? () => onSchedule(product) : undefined}
          />
        ))}
      </ol>
    </SortableContext>
  )
}
