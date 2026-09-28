import { getStorePolicyIds } from "./get-store-policy-ids"

export function createMerchantReturnPolicy(siteUrl: URL) {
  return {
    "@type": "MerchantReturnPolicy" as const,
    "@id": getStorePolicyIds(siteUrl).merchantReturnPolicy,
    // Google's link-only policy format preserves the distinction between defects and change-of-mind returns.
    merchantReturnLink: new URL("/returns", siteUrl).href,
  }
}
