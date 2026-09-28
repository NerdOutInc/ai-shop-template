import "server-only"

import { parseMetaCart } from "@/features/cart/parse-meta-cart"

import { isCheckoutSessionId } from "./is-checkout-session-id"

type RecoveryData =
  | { kind: "success"; sessionId: string | null; createdAt: number }
  | { kind: "meta"; params: { products?: string; coupon?: string }; createdAt: number }

const prefix = "store-checkout-recovery-"
function lifetime(kind: RecoveryData["kind"]) {
  return (kind === "success" ? 30 : 1) * 24 * 60 * 60 * 1000
}

function decode(value: string, now = Date.now()): RecoveryData | null {
  try {
    if (value.length > 3000) return null
    const data: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
    if (!data || typeof data !== "object" || !("createdAt" in data) || !("kind" in data)) return null
    if (data.kind !== "success" && data.kind !== "meta") return null
    if (
      typeof data.createdAt !== "number" ||
      !Number.isFinite(data.createdAt) ||
      data.createdAt > now ||
      now - data.createdAt >= lifetime(data.kind)
    )
      return null
    if (data.kind === "success" && "sessionId" in data)
      return data.sessionId === null || isCheckoutSessionId(data.sessionId)
        ? { kind: "success", sessionId: data.sessionId, createdAt: data.createdAt }
        : null
    if (data.kind !== "meta" || !("params" in data) || !data.params || typeof data.params !== "object") return null
    const params = data.params
    const products = "products" in params ? params.products : undefined
    const coupon = "coupon" in params ? params.coupon : undefined
    if ((products !== undefined && typeof products !== "string") || (coupon !== undefined && coupon !== "unsupported"))
      return null
    if (products !== undefined && parseMetaCart({ products }).status !== "ready") return null
    return { kind: "meta", params: { products, coupon }, createdAt: data.createdAt }
  } catch {
    return null
  }
}

export const checkoutRecoveryCookie = {
  prefix,
  lifetime,
  decode,
  fromUrl(url: URL, now = Date.now()): RecoveryData {
    if (url.pathname === "/checkout/success") {
      const sessions = url.searchParams.getAll("session_id")
      const sessionId = sessions.length === 1 && isCheckoutSessionId(sessions[0]) ? sessions[0] : null
      return { kind: "success", sessionId, createdAt: now }
    }
    const params = Object.fromEntries(
      [...url.searchParams.keys()].map((key) => {
        const values = url.searchParams.getAll(key)
        return [key, values.length === 1 ? values[0] : values]
      })
    )
    const parsed = parseMetaCart(params)
    return {
      kind: "meta",
      params:
        parsed.status === "ready"
          ? {
              products: parsed.selection
                .map(({ productId, variantId, quantity }) => `${productId}-${variantId}:${quantity}`)
                .join(","),
            }
          : parsed.reason === "coupon"
            ? { coupon: "unsupported" }
            : {},
      createdAt: now,
    }
  },
  encode(data: RecoveryData) {
    return Buffer.from(JSON.stringify(data)).toString("base64url")
  },
}
