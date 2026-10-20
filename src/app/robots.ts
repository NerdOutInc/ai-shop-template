import type { MetadataRoute } from "next"

import { getSiteUrl } from "@/lib/get-site-url"
import { isIndexableSite } from "@/lib/is-indexable-site"
import { storeConfig } from "@/lib/store-config"

/** Crawlers that fetch pages for AI answers, shopping agents or model training; see docs/agent-commerce.md. */
const aiCrawlers = [
  "GPTBot",
  "OAI-SearchBot",
  "ClaudeBot",
  "Claude-SearchBot",
  "PerplexityBot",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
]

export default function robots(): MetadataRoute.Robots {
  if (!isIndexableSite()) return { rules: { userAgent: "*", disallow: "/" } }
  // The agent surfaces sit under the blocked /api/ prefix, so each gets a longer, winning Allow.
  const allow = ["/", "/api/catalog", "/llms.txt"]
  // Cart stays crawlable so its noindex metadata can be read. Checkout pages are payment return
  // URLs that are never linked, and the merchant feeds are password-protected: neither is for crawlers.
  const disallow = ["/api/", "/admin", "/auth/", "/checkout/", "/feeds/"]
  return {
    rules: [
      { userAgent: "*", allow, disallow },
      storeConfig.seo.aiCrawlers === "allow"
        ? { userAgent: aiCrawlers, allow, disallow }
        : { userAgent: aiCrawlers, disallow: "/" },
    ],
    sitemap: new URL("/sitemap.xml", getSiteUrl()).href,
  }
}
