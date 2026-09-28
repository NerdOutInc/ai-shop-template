export type CartItem = {
  productId: string
  variantId: number
  title: string
  variantTitle: string
  image?: string
  unitAmount: number
  quantity: number
}

export type CartEntry = CartItem & { entryId: string }

export type CartState = {
  version: 1
  entries: CartEntry[]
  checkouts: Record<string, { createdAt: number; entries: { entryId: string; quantity: number }[] }>
}
