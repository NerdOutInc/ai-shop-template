import { getSitemapProductIds } from "@/features/catalog/get-sitemap-product-ids.server"
import { getSiteUrl } from "@/lib/get-site-url"
import { storeConfig } from "@/lib/store-config"
import { isIndexableSite } from "@/lib/is-indexable-site"

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

export async function GET() {
  if (!isIndexableSite()) {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } })
  }
  try {
    const productIds = await getSitemapProductIds()
    const paths = [
      "/",
      ...(storeConfig.features.about ? ["/about"] : []),
      "/shop",
      "/shipping",
      "/returns",
      "/privacy",
      ...productIds.map((id) => `/shop/${encodeURIComponent(id)}`),
    ]
    const siteUrl = getSiteUrl()
    const entries = [...new Set(paths)].map((path) => `<url><loc>${escapeXml(new URL(path, siteUrl).href)}</loc></url>`)
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.join("")}</urlset>`,
      {
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Cache-Control": "public, max-age=0, s-maxage=300",
        },
      }
    )
  } catch {
    return new Response("Sitemap temporarily unavailable", {
      status: 503,
      headers: { "Cache-Control": "no-store", "Retry-After": "300" },
    })
  }
}
