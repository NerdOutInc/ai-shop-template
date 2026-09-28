import "server-only"

import { MerchantFeedError } from "./merchant-feed-error"

export function logMerchantFeedFailure(error: unknown, source: "route" | "publishing-health") {
  const failure = error instanceof MerchantFeedError ? error : new MerchantFeedError("UNKNOWN_ERROR")
  console.error("Merchant feed unavailable", {
    source,
    code: failure.code,
    ...(failure.productId ? { productId: failure.productId } : {}),
  })
}
