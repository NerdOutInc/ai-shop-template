type VisitSource = "organic_search" | "paid" | "social" | "email" | "referral" | "direct"

export function classifyStoreVisitSource(url: URL, documentReferrer: string): VisitSource {
  const parameters = url.searchParams
  if (["gclid", "dclid", "msclkid"].some((key) => parameters.has(key))) return "paid"
  const medium = parameters.get("utm_medium")?.toLowerCase()
  if (medium && ["cpc", "ppc", "paid", "paid_search", "paid_social", "display", "cpm"].includes(medium)) return "paid"
  if (medium === "email") return "email"
  if (medium === "social" || medium === "social_media") return "social"
  if (medium === "organic") return "organic_search"
  // Meta's checkout handoff can omit the referrer; explicit campaigns still take precedence.
  const cartOrigin = parameters.get("cart_origin")
  if (cartOrigin && ["facebook", "instagram", "meta_shops"].includes(cartOrigin)) return "social"
  if (!documentReferrer) return "direct"
  const referrer = new URL(documentReferrer)
  if (referrer.origin === url.origin) return "direct"
  const host = referrer.hostname
  const matchesHost = (domain: string) => host === domain || host.endsWith(`.${domain}`)
  // Payment providers are a continuation of the visit, never an acquisition source.
  if (matchesHost("stripe.com")) return "direct"
  if (
    /(^|\.)google\.(com|[a-z]{2}|co\.uk|com\.au|co\.in|co\.nz|co\.jp)$/.test(host) ||
    ["bing.com", "duckduckgo.com", "search.yahoo.com", "ecosia.org", "search.brave.com"].some(matchesHost)
  )
    return "organic_search"
  if (
    ["instagram.com", "facebook.com", "tiktok.com", "pinterest.com", "reddit.com", "youtube.com", "t.co", "x.com"].some(
      matchesHost
    )
  )
    return "social"
  return "referral"
}
