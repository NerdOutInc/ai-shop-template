"use client"

import { createContext } from "react"

import type { CartItem, CartState } from "./cart-item"
import type { CartImportStatus } from "./import-cart-items"

export type CartContextValue = {
  items: CartItem[]
  count: number
  subtotal: number
  hydrated: boolean
  persistenceWarning: boolean
  addItem: (item: CartItem) => boolean
  importedCarts: readonly string[]
  importCart: (items: CartItem[], importKey: string) => Promise<CartImportStatus>
  setQuantity: (productId: string, variantId: number, quantity: number) => void
  removeItem: (productId: string, variantId: number) => void
  createCheckoutSnapshot: () => CartState["checkouts"][string]
  rememberCheckout: (sessionId: string, snapshot?: CartState["checkouts"][string]) => void
  confirmPurchase: (sessionId: string) => void
}

export const CartContext = createContext<CartContextValue | null>(null)
