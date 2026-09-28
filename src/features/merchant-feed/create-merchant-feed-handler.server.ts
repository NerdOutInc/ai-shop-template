import "server-only"

import { getSiteUrl } from "@/lib/get-site-url"
import { isIndexableSite } from "@/lib/is-indexable-site"

import { createMerchantFeed } from "./create-merchant-feed"
import { getMerchantProducts } from "./get-merchant-products.server"
import { isMerchantFeedAuthorized } from "./is-merchant-feed-authorized.server"
import { logMerchantFeedFailure } from "./log-merchant-feed-failure.server"

export function createMerchantFeedHandler(destination: "google" | "meta") {
  return async function GET(request: Request) {
    const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" }
    if (!isIndexableSite() || !isMerchantFeedAuthorized(request, destination)) {
      return new Response(null, { status: 404, headers })
    }

    try {
      const products = await getMerchantProducts()
      return new Response(createMerchantFeed(products, getSiteUrl(), destination), {
        headers: {
          ...headers,
          "Content-Type": "application/xml; charset=utf-8",
        },
      })
    } catch (error) {
      logMerchantFeedFailure(error, "route")
      // A failed refresh must not tell a catalog importer that published products were removed.
      return new Response("Product feed temporarily unavailable", {
        status: 503,
        headers: { ...headers, "Retry-After": "300" },
      })
    }
  }
}
