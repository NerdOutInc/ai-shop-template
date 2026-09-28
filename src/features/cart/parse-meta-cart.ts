import { cartLimits } from "@/lib/cart-limits"

export type MetaCartSearchParams = Record<string, string | string[] | undefined>
export type MetaCartSelection = { productId: string; variantId: number; quantity: number }
export type MetaCartError = "invalid" | "coupon" | "unavailable"

export function parseMetaCart(
  params: MetaCartSearchParams
): { status: "ready"; selection: MetaCartSelection[] } | { status: "error"; reason: MetaCartError } {
  if (Array.isArray(params.coupon)) return { status: "error", reason: "invalid" }
  if (params.coupon) return { status: "error", reason: "coupon" }
  if (typeof params.products !== "string" || !params.products || params.products.length > 4096)
    return { status: "error", reason: "invalid" }
  const entries = params.products.split(",")
  if (entries.length > cartLimits.maxLines) return { status: "error", reason: "invalid" }
  const selection = new Map<string, MetaCartSelection>()
  let total = 0
  for (const entry of entries) {
    const match = /^([a-f0-9]{24})-([1-9]\d*):([1-9]\d*)$/.exec(entry)
    if (!match || match[0] !== entry) return { status: "error", reason: "invalid" }
    const productId = match[1]!
    const variantId = Number(match[2])
    const quantity = Number(match[3])
    const key = `${productId}-${variantId}`
    const combined = (selection.get(key)?.quantity ?? 0) + quantity
    total += quantity
    if (
      !Number.isSafeInteger(variantId) ||
      !Number.isSafeInteger(quantity) ||
      combined > cartLimits.maxQuantityPerVariant ||
      total > cartLimits.maxTotalQuantity
    )
      return { status: "error", reason: "invalid" }
    selection.set(key, { productId, variantId, quantity: combined })
  }
  // Equivalent ordering and repeated lines identify the same selection on reload or return.
  return {
    status: "ready",
    selection: [...selection.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, item]) => item),
  }
}
