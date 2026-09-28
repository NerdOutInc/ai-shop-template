import "server-only"

import { createHash } from "node:crypto"

import { parsePrintifyProduct } from "@/lib/printify/parse-printify-product"

/** Color/price changes do not alter art identity; every enabled production layout must remain approved. */
export function productArtworkFingerprint(
  raw: unknown,
  expected: { shopId: string; productId: string }
): string | null {
  const product = parsePrintifyProduct(raw, expected)
  const fingerprints = product?.variants
    .filter((variant) => variant.enabled)
    .map((variant) => variant.designFingerprint)
  if (!fingerprints?.length) return null
  return `artwork-v1:${createHash("sha256")
    .update(JSON.stringify([...new Set(fingerprints)].sort()))
    .digest("hex")}`
}
