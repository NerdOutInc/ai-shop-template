import { storeConfig } from "@/lib/store-config"

export function calculateCartShipping(items: readonly { quantity: number }[]) {
  const quantity = items.reduce((sum, item) => sum + item.quantity, 0)
  return quantity === 0
    ? 0
    : storeConfig.commerce.firstItemShippingCents + storeConfig.commerce.additionalItemShippingCents * (quantity - 1)
}
