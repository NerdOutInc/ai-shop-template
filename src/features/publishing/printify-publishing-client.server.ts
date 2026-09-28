import "server-only"

import { PrintifyRequestError } from "./printify-request-error"

function retryDelay(value: string | null) {
  if (!value) return undefined
  const seconds = /^\d+$/.test(value) ? Number(value) : (Date.parse(value) - Date.now()) / 1000
  return Number.isFinite(seconds) ? Math.max(1, Math.min(3600, Math.ceil(seconds))) : undefined
}

function wasNotSent(error: unknown) {
  if (!(error instanceof TypeError) || !error.cause || typeof error.cause !== "object") return false
  // Only connection-establishment failures prove that no HTTP request was sent.
  const code = "code" in error.cause ? error.cause.code : undefined
  return ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"].includes(String(code))
}

export class PrintifyPublishingClient {
  constructor(
    private readonly apiToken: string,
    readonly shopId: string
  ) {
    if (!apiToken.trim() || /[\r\n]/.test(apiToken) || !/^[1-9]\d*$/.test(shopId))
      throw new Error("Publishing client is not configured")
  }

  async request(
    productId: string,
    action?: "publishing_succeeded" | "publishing_failed" | "unpublish",
    body?: unknown
  ): Promise<Record<string, unknown> | null> {
    try {
      const path = `products/${encodeURIComponent(productId)}${action ? `/${action}` : ""}.json`
      const response = await fetch(`https://api.printify.com/v1/shops/${this.shopId}/${path}`, {
        method: action ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          "User-Agent": "Clothing-Store/0.1",
          Accept: "application/json",
          ...(action ? { "Content-Type": "application/json" } : {}),
        },
        body: action ? JSON.stringify(body ?? {}) : undefined,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      })
      if (!action && response.status === 404) return null
      if (response.status === 429)
        throw new PrintifyRequestError("rate-limited", retryDelay(response.headers.get("retry-after")))
      if (response.status >= 400 && response.status < 500 && response.status !== 408)
        throw new PrintifyRequestError("rejected")
      if (!response.ok) throw new PrintifyRequestError("uncertain")
      if (action) return null
      const raw: unknown = await response.json()
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("INVALID_PRODUCT")
      const product = raw as Record<string, unknown>
      if (product.id !== productId || String(product.shop_id) !== this.shopId) throw new Error("INVALID_PRODUCT")
      return product
    } catch (error) {
      if (error instanceof PrintifyRequestError) throw error
      throw new PrintifyRequestError(wasNotSent(error) ? "not-sent" : "uncertain")
    }
  }
}
