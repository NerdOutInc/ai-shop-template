import "server-only"

import { z } from "zod"

import { CheckoutError } from "./checkout-error"

const configSchema = z.object({
  apiToken: z
    .string()
    .trim()
    .min(1)
    .refine((value) => !/[\r\n]/.test(value)),
  shopId: z.string().regex(/^[1-9]\d*$/),
})

export class PrintifyClient {
  readonly shopId: string
  private readonly apiToken: string

  constructor(config: { apiToken?: string; shopId?: string }) {
    const result = configSchema.safeParse(config)
    if (!result.success)
      throw new CheckoutError("NOT_CONFIGURED", "Checkout is not available yet. Please try again later.")
    this.shopId = result.data.shopId
    this.apiToken = result.data.apiToken
  }

  async request(path: string, body?: unknown): Promise<unknown> {
    try {
      const response = await fetch(`https://api.printify.com/v1/shops/${this.shopId}/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          "User-Agent": "Clothing-Store/0.1",
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok)
        throw new CheckoutError(
          "PRINTIFY_UNAVAILABLE",
          "Our print partner is taking a breather. Please try again shortly."
        )
      if (response.status === 204) return null
      const text = await response.text()
      return text ? (JSON.parse(text) as unknown) : null
    } catch {
      // Provider responses and transport exceptions can contain credentials or personal information.
      throw new CheckoutError(
        "PRINTIFY_UNAVAILABLE",
        "Our print partner is taking a breather. Please try again shortly."
      )
    }
  }
}
