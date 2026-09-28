import "server-only"

import { parsePrintifyProduct } from "@/lib/printify/parse-printify-product"

import { CheckoutError } from "./checkout-error"
import type { PrintifyClient } from "./printify-client.server"

type CheckoutProduct = {
  id: string
  title: string
  variants: {
    id: number
    unitAmount: number
    available: boolean
    label: string
    imageUrl?: string
    fingerprint: string
  }[]
}

export async function readCheckoutProduct(client: PrintifyClient, productId: string): Promise<CheckoutProduct> {
  const product = parsePrintifyProduct(await client.request(`products/${encodeURIComponent(productId)}.json`), {
    productId,
    shopId: client.shopId,
  })
  if (!product) {
    throw new CheckoutError(
      "PRODUCT_UNAVAILABLE",
      "A shirt in your bag is currently unavailable. Please refresh your bag.",
      409
    )
  }
  return {
    id: product.id,
    title: product.title,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      unitAmount: variant.unitAmount,
      // Disabled-variant order acceptance is undocumented; stop before payment instead of risking fulfillment.
      available: variant.inStock && variant.enabled,
      label: variant.label,
      ...(variant.imageUrl ? { imageUrl: variant.imageUrl } : {}),
      fingerprint: variant.fingerprint,
    })),
  }
}
