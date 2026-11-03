import "server-only"

import { MerchantFeedError } from "@/features/merchant-feed/merchant-feed-error"
import { env } from "@/lib/env"
import { isIndexableSite } from "@/lib/is-indexable-site"

import { getAgentCatalog } from "./get-agent-catalog.server"

// Crawlable (robots allows it) but never a search result of its own: the product pages are.
const uncached = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" }
const cached = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
  "X-Robots-Tag": "noindex",
}

/** The whole catalog, or one product of it when `productId` is given; see docs/agent-commerce.md. */
export async function createAgentCatalogResponse(productId?: string): Promise<Response> {
  if (!isIndexableSite() || !env.PRINTIFY_PUBLISHING_ENABLED)
    return new Response(null, { status: 404, headers: uncached })
  try {
    const catalog = await getAgentCatalog()
    if (productId === undefined) return Response.json(catalog, { headers: cached })
    const product = catalog.products.find((item) => item.id === productId)
    if (!product) return Response.json({ error: "Product not found" }, { status: 404, headers: uncached })
    return Response.json({ store: catalog.store, product }, { headers: cached })
  } catch (error) {
    // Codes are diagnostic; provider messages and connection details stay out of the logs.
    const failure = error instanceof MerchantFeedError ? error : null
    console.error("Agent catalog unavailable", {
      code: failure?.code ?? "UNKNOWN_ERROR",
      ...(failure?.productId ? { productId: failure.productId } : {}),
    })
    // A failed read must not tell an agent that every product was removed.
    return Response.json(
      { error: "Catalog temporarily unavailable" },
      { status: 503, headers: { ...uncached, "Retry-After": "300" } }
    )
  }
}
