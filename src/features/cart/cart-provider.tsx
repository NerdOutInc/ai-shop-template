"use client"

import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react"

import { CartContext } from "./cart-context"
import type { CartItem, CartState } from "./cart-item"
import { getCartImportKey } from "./get-cart-import-key"
import { importCartItems } from "./import-cart-items"
import { readCartState } from "./read-cart-state"
import { updateCart } from "./update-cart"

const storageKey = "your-store-cart-v1"
const emptyState: CartState = { version: 1, entries: [], checkouts: {} }
const serverSnapshot = { state: emptyState, hydrated: false, persistenceWarning: false }

function createStore() {
  let snapshot = serverSnapshot
  let loaded = false
  const listeners = new Set<() => void>()
  function read() {
    try {
      snapshot = {
        state: readCartState(window.localStorage.getItem(storageKey)),
        hydrated: true,
        persistenceWarning: false,
      }
    } catch {
      snapshot = { ...snapshot, hydrated: true, persistenceWarning: true }
    }
    loaded = true
  }
  function publish(state: CartState) {
    let persistenceWarning = false
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(state))
    } catch {
      persistenceWarning = true
    }
    snapshot = { state, hydrated: true, persistenceWarning }
    listeners.forEach((listener) => listener())
  }
  function dispatch(action: Parameters<typeof updateCart>[1]) {
    if (!loaded) read()
    const next = updateCart(snapshot.state, action)
    if (next === snapshot.state) return false
    publish(next)
    return true
  }
  return {
    getSnapshot() {
      if (!loaded) read()
      return snapshot
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      const onStorage = (event: StorageEvent) => {
        if (event.key !== storageKey && event.key !== null) return
        read()
        listeners.forEach((notify) => notify())
      }
      window.addEventListener("storage", onStorage)
      return () => {
        listeners.delete(listener)
        window.removeEventListener("storage", onStorage)
      }
    },
    addItem(item: CartItem) {
      const entryId = crypto.randomUUID()
      const validated = readCartState(JSON.stringify({ version: 1, entries: [{ ...item, entryId }], checkouts: {} }))
      const entry = validated.entries[0]
      if (!entry || validated.entries.length !== 1) return false
      return dispatch({ type: "add", item: entry, entryId })
    },
    async importCart(items: CartItem[], importKey: string) {
      const apply = () => {
        // See another tab's recent import before deciding whether to add this selection.
        if (!loaded || !snapshot.persistenceWarning) read()
        const result = importCartItems(snapshot.state, items, importKey)
        if (result.status === "added") publish(result.state)
        else listeners.forEach((listener) => listener())
        return result.status
      }
      if (navigator.locks) return navigator.locks.request(`${storageKey}-import`, apply)
      return apply()
    },
    setQuantity(productId: string, variantId: number, quantity: number) {
      dispatch({ type: "quantity", productId, variantId, quantity, entryId: crypto.randomUUID() })
    },
    removeItem(productId: string, variantId: number) {
      dispatch({ type: "quantity", productId, variantId, quantity: 0, entryId: crypto.randomUUID() })
    },
    createCheckoutSnapshot() {
      if (!loaded) read()
      return {
        createdAt: Date.now(),
        entries: snapshot.state.entries.map(({ entryId, quantity }) => ({ entryId, quantity })),
      }
    },
    rememberCheckout(sessionId: string, checkoutSnapshot?: CartState["checkouts"][string]) {
      dispatch({
        type: "remember",
        sessionId,
        createdAt: checkoutSnapshot?.createdAt ?? Date.now(),
        entries: checkoutSnapshot?.entries,
      })
    },
    confirmPurchase(sessionId: string) {
      dispatch({ type: "consume", sessionId })
    },
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createStore)
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, () => serverSnapshot)
  const value = useMemo(() => {
    const grouped = new Map<string, CartItem>()
    for (const entry of snapshot.state.entries) {
      const key = `${entry.productId}:${entry.variantId}`
      const existing = grouped.get(key)
      grouped.set(key, { ...entry, quantity: (existing?.quantity ?? 0) + entry.quantity })
    }
    const items = Array.from(grouped.values())
    return {
      items,
      count: items.reduce((sum, item) => sum + item.quantity, 0),
      subtotal: items.reduce((sum, item) => sum + item.quantity * item.unitAmount, 0),
      hydrated: snapshot.hydrated,
      persistenceWarning: snapshot.persistenceWarning,
      addItem: store.addItem,
      importedCarts: [
        ...new Set(
          snapshot.state.entries.flatMap(({ entryId }) => {
            const importKey = getCartImportKey(entryId)
            return importKey ? [importKey] : []
          })
        ),
      ],
      importCart: store.importCart,
      setQuantity: store.setQuantity,
      removeItem: store.removeItem,
      createCheckoutSnapshot: store.createCheckoutSnapshot,
      rememberCheckout: store.rememberCheckout,
      confirmPurchase: store.confirmPurchase,
    }
  }, [snapshot, store])
  return <CartContext value={value}>{children}</CartContext>
}
