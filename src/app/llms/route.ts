import { getSitemapProducts } from "@/features/catalog/get-sitemap-products.server"
import { getSiteUrl } from "@/lib/get-site-url"
import { isIndexableSite } from "@/lib/is-indexable-site"
import { storeConfig } from "@/lib/store-config"

/** Keep a product title on one Markdown line and out of the link's own syntax. */
function markdownText(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/[[\]\\]/g, "\\$&")
    .trim()
}

/** Served as /llms.txt by the rewrite in next.config.ts; see docs/agent-commerce.md. */
export async function GET() {
  if (!isIndexableSite()) {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } })
  }
  try {
    const products = await getSitemapProducts()
    const siteUrl = getSiteUrl()
    const href = (path: string) => new URL(path, siteUrl).href
    const lines = [
      `# ${markdownText(storeConfig.name)}`,
      "",
      `> ${markdownText(storeConfig.description)}`,
      "",
      markdownText(storeConfig.tagline),
      "",
      `${markdownText(storeConfig.name)} sells original apparel printed to order. Prices are in USD and ship within the United States.`,
      "",
      "## Store",
      "",
      `- [Shop](${href("/shop")}): every published product`,
      `- [Product catalog (JSON)](${href("/api/catalog")}): machine-readable products, variants, prices and stock`,
      `- [Sitemap](${href("/sitemap.xml")})`,
      ...(storeConfig.features.about ? [`- [About](${href("/about")})`] : []),
      "",
      "## Policies",
      "",
      `- [Shipping](${href("/shipping")}): shipping rates and delivery estimates`,
      `- [Returns](${href("/returns")}): return and replacement policy`,
      `- [Privacy](${href("/privacy")})`,
      "",
      "## Products",
      "",
      ...products.map(
        (product) => `- [${markdownText(product.title)}](${href(`/shop/${encodeURIComponent(product.id)}`)})`
      ),
      "",
    ]
    return new Response(lines.join("\n"), {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "public, max-age=0, s-maxage=300",
      },
    })
  } catch {
    return new Response("llms.txt temporarily unavailable", {
      status: 503,
      headers: { "Cache-Control": "no-store", "Retry-After": "300" },
    })
  }
}
