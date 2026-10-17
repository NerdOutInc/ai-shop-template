import "server-only"

import { createHash } from "node:crypto"
import type { GoogleMerchantCopy } from "./google-merchant-copy-schema"

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value === null || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => [key, canonical(entry)])
  )
}

/** Consistency only: this unkeyed digest neither authenticates nor attests to approval. */
export function googleMerchantCopyReviewDigest(
  shopId: string,
  productId: string,
  revision: string,
  copy: GoogleMerchantCopy
) {
  return createHash("sha256")
    .update(JSON.stringify(canonical([shopId, productId, revision, copy])))
    .digest("hex")
}
