import "server-only"

import { parsePrintifyProduct } from "@/lib/printify/parse-printify-product"
import { productionFingerprintVersion } from "@/lib/printify/production-fingerprint-version"

export function observePublishedStock(
  live: Record<string, unknown>,
  expected: { productId: string; shopId: string },
  observedAt: number
) {
  const product = parsePrintifyProduct(live, expected)
  return {
    observedAt,
    fingerprintVersion: productionFingerprintVersion,
    products: {
      [expected.productId]:
        product?.variants.map(({ id, enabled, inStock, fingerprint }) => ({
          id,
          enabled,
          inStock,
          fingerprint,
        })) ?? [],
    },
  }
}
