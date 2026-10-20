import { getSitemapProducts } from "@/features/catalog/get-sitemap-products.server"
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
    const products = await getSitemapProducts()
    const siteUrl = getSiteUrl()
    const staticPaths = [
      "/",
      ...(storeConfig.features.about ? ["/about"] : []),
      "/shop",
      "/shipping",
      "/returns",
      "/privacy",
    ]
    const entries = staticPaths.map((path) => `<url><loc>${escapeXml(new URL(path, siteUrl).href)}</loc></url>`)
    const seen = new Set<string>()
    for (const product of products) {
      const loc = new URL(`/shop/${encodeURIComponent(product.id)}`, siteUrl).href
      if (seen.has(loc)) continue
      seen.add(loc)
      const lastModified = product.lastModified ? Date.parse(product.lastModified) : Number.NaN
      entries.push(
        [
          `<url><loc>${escapeXml(loc)}</loc>`,
          Number.isFinite(lastModified) ? `<lastmod>${new Date(lastModified).toISOString()}</lastmod>` : "",
          product.image ? `<image:image><image:loc>${escapeXml(product.image)}</image:loc></image:image>` : "",
          "</url>",
        ].join("")
      )
    }
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${entries.join("")}</urlset>`,
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
