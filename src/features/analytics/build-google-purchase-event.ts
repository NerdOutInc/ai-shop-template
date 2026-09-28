import { cartLimits } from "@/lib/cart-limits"

export type GooglePurchaseEvent = {
  transaction_id: string
  currency: "USD"
  value: number
  shipping: number
  tax: number
  items: { item_id: string; price: number; quantity: number }[]
}

function amount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    Number.isSafeInteger(Math.round(value * 100)) &&
    Math.round(value * 100) / 100 === value
  )
}

/** Projects only the supported Google fields; the server must establish payment eligibility first. */
export function buildGooglePurchaseEvent(input: unknown): GooglePurchaseEvent | null {
  if (!input || typeof input !== "object") return null
  const value = input as Record<string, unknown>
  if (
    typeof value.transaction_id !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.transaction_id) ||
    value.currency !== "USD" ||
    !amount(value.value) ||
    !amount(value.shipping) ||
    !amount(value.tax) ||
    !Array.isArray(value.items) ||
    !value.items.length ||
    value.items.length > cartLimits.maxLines
  )
    return null
  const items: GooglePurchaseEvent["items"] = []
  const ids = new Set<string>()
  let subtotal = 0
  let quantity = 0
  for (const row of value.items) {
    if (!row || typeof row !== "object") return null
    const item = row as Record<string, unknown>
    if (
      typeof item.item_id !== "string" ||
      !/^[a-f0-9]{24}-[1-9][0-9]*$/.test(item.item_id) ||
      ids.has(item.item_id) ||
      !Number.isSafeInteger(Number(item.item_id.slice(25))) ||
      !amount(item.price) ||
      item.price <= 0 ||
      Math.round(item.price * 100) > cartLimits.maxUnitAmount ||
      typeof item.quantity !== "number" ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity <= 0 ||
      item.quantity > cartLimits.maxQuantityPerVariant
    )
      return null
    ids.add(item.item_id)
    quantity += item.quantity
    subtotal += Math.round(item.price * 100) * item.quantity
    items.push({ item_id: item.item_id, price: item.price, quantity: item.quantity })
  }
  if (quantity > cartLimits.maxTotalQuantity || subtotal !== Math.round(value.value * 100)) return null
  return {
    transaction_id: value.transaction_id,
    currency: "USD",
    value: value.value,
    shipping: value.shipping,
    tax: value.tax,
    items,
  }
}
