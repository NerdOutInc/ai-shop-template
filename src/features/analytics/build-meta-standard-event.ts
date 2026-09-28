import { cartLimits } from "@/lib/cart-limits"

import type { MetaStandardEvent } from "./meta-standard-event"

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isProductId(value: unknown): value is string {
  return typeof value === "string" && value.length === 24 && /^[a-f0-9]{24}$/.test(value)
}

function isPositiveInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= maximum
}

function buildItems(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > cartLimits.maxLines) return null
  const lines = new Map<string, { id: string; quantity: number; unitAmount: number }>()
  let quantity = 0
  let subtotal = 0
  for (const item of value) {
    if (
      !isRecord(item) ||
      !isProductId(item.productId) ||
      !isPositiveInteger(item.variantId) ||
      !isPositiveInteger(item.quantity, cartLimits.maxQuantityPerVariant) ||
      !isPositiveInteger(item.unitAmount, cartLimits.maxUnitAmount)
    )
      return null
    const id = `${item.productId}-${item.variantId}`
    const previous = lines.get(id)
    const combinedQuantity = (previous?.quantity ?? 0) + item.quantity
    if (combinedQuantity > cartLimits.maxQuantityPerVariant || (previous && previous.unitAmount !== item.unitAmount))
      return null
    quantity += item.quantity
    if (quantity > cartLimits.maxTotalQuantity) return null
    subtotal += item.quantity * item.unitAmount
    lines.set(id, { id, quantity: combinedQuantity, unitAmount: item.unitAmount })
  }
  return {
    content_type: "product" as const,
    content_ids: [...lines.keys()],
    contents: [...lines.values()].map(({ id, quantity, unitAmount }) => ({
      id,
      quantity,
      item_price: unitAmount / 100,
    })),
    currency: "USD" as const,
    value: subtotal / 100,
    num_items: quantity,
  }
}

/** Formats an eligible event; payment verification and consent belong to the caller. */
export function buildMetaStandardEvent(input: unknown): MetaStandardEvent | null {
  if (!isRecord(input)) return null
  if (input.name === "ViewContent") {
    if (!isProductId(input.productId)) return null
    if (input.variant === undefined)
      return { name: input.name, parameters: { content_type: "product_group", content_ids: [input.productId] } }
    if (!isRecord(input.variant)) return null
    const parameters = buildItems([
      {
        productId: input.productId,
        variantId: input.variant.variantId,
        unitAmount: input.variant.unitAmount,
        quantity: 1,
      },
    ])
    return parameters ? { name: input.name, parameters } : null
  }
  if (input.name === "AddToCart" || input.name === "InitiateCheckout") {
    const parameters = buildItems(input.items)
    return parameters ? { name: input.name, parameters } : null
  }
  if (input.name !== "Purchase" || !isRecord(input.purchase)) return null
  const { receipt, totalUsd } = input.purchase
  if (
    typeof receipt !== "string" ||
    receipt.length !== 64 ||
    !/^[a-f0-9]{64}$/.test(receipt) ||
    typeof totalUsd !== "number" ||
    !Number.isFinite(totalUsd)
  )
    return null
  const cents = Math.round(totalUsd * 100)
  const parameters = buildItems(input.purchase.items)
  if (!parameters || !Number.isSafeInteger(cents) || cents / 100 !== totalUsd || totalUsd < parameters.value)
    return null
  // The receipt is a local duplicate marker. No checkout or customer fields leave this boundary.
  return { name: input.name, parameters: { ...parameters, value: totalUsd } }
}
