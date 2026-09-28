import "server-only"

import { readPublishedProduct } from "@/features/publishing/read-published-product.server"
import { env } from "@/lib/env"
import { parsePrintifyProduct } from "@/lib/printify/parse-printify-product"

import { CheckoutError } from "./checkout-error"
import type { OrderItem } from "./checkout-order"
import type { HostedCheckoutRequest } from "./hosted-checkout-request"
import type { PrintifyClient } from "./printify-client.server"
import { readCheckoutProduct } from "./read-checkout-product.server"

export async function readCheckoutItems(client: PrintifyClient, request: Pick<HostedCheckoutRequest, "items">) {
  const ids = [...new Set(request.items.map((item) => item.productId))]
  if (!env.PRINTIFY_PUBLISHING_ENABLED)
    throw new CheckoutError("NOT_CONFIGURED", "Checkout is unavailable while we finish connecting the shop.")
  const keys = request.items.map((item) => `${item.productId}:${item.variantId}`)
  if (new Set(keys).size !== keys.length)
    throw new CheckoutError("INVALID_REQUEST", "Please combine duplicate shirts in your bag.", 400)
  const published = await Promise.all(
    ids.map(async (productId) => {
      const product = parsePrintifyProduct(await readPublishedProduct(productId), {
        productId,
        shopId: client.shopId,
      })
      if (!product)
        throw new CheckoutError(
          "PRODUCT_UNAVAILABLE",
          "A shirt in your bag is no longer offered. Please refresh your bag.",
          409
        )
      return product
    })
  )
  const products = await Promise.all(ids.map((id) => readCheckoutProduct(client, id)))
  const items: OrderItem[] = request.items.map((item) => {
    const liveProduct = products.find((product) => product.id === item.productId)
    const liveVariant = liveProduct?.variants.find((variant) => variant.id === item.variantId)
    const product = published.find((product) => product.id === item.productId)
    const variant = product?.variants.find((variant) => variant.id === item.variantId)
    if (!product || !variant || !liveVariant?.available || !variant.enabled || variant.unitAmount <= 0)
      throw new CheckoutError(
        "PRODUCT_UNAVAILABLE",
        "A selected size is no longer available. Please choose another size.",
        409
      )
    if (liveVariant.fingerprint !== variant.fingerprint)
      throw new CheckoutError("PRODUCT_CHANGED", "A selected shirt is being updated. Please try again shortly.", 409)
    if (variant.unitAmount !== item.expectedUnitAmount)
      throw new CheckoutError(
        "PRICE_CHANGED",
        "A shirt price has changed. Please refresh your bag and review the new price.",
        409
      )
    return {
      productId: product.id,
      variantId: variant.id,
      title: product.title,
      variantLabel: variant.label,
      ...(variant.imageUrl ? { imageUrl: variant.imageUrl } : {}),
      unitAmount: variant.unitAmount,
      quantity: item.quantity,
      productFingerprint: variant.fingerprint,
    }
  })
  return items
}
