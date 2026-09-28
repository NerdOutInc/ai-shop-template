/** A published product's current or upcoming weekly feature. */
export type ProductScheduleEntry = {
  id: string
  productId: string
  liveAt: string
}

/** Public membership contains only product IDs, never private design-library records. */
export type ProductWeek = {
  liveAt: string
  productIds: string[]
}

/** Saved state for affected products, including a clock that may have advanced during a lock wait. */
export type ProductScheduleReceipt = {
  entries: ProductScheduleEntry[]
  products: {
    productId: string
    hiddenAt: string | null
    revealAt: string | null
    revealedAt: string | null
  }[]
  now: number
}
