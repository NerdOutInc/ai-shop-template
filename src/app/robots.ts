import type { MetadataRoute } from "next"

import { getSiteUrl } from "@/lib/get-site-url"
import { isIndexableSite } from "@/lib/is-indexable-site"

export default function robots(): MetadataRoute.Robots {
  if (!isIndexableSite()) return { rules: { userAgent: "*", disallow: "/" } }
  return {
    // Cart and checkout must remain crawlable so their noindex metadata can be read.
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/admin", "/auth/"] },
    sitemap: new URL("/sitemap.xml", getSiteUrl()).href,
  }
}
