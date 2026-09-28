import { classifyStoreVisitSource } from "@/features/analytics/classify-store-visit-source"

import { orderAttributionSchema, type OrderAttribution } from "./order-attribution-schema"

function label(value: string | null) {
  return value && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value) ? value : null
}

function platform(host: string) {
  const matches = (domain: string) => host === domain || host.endsWith(`.${domain}`)
  if (/(^|\.)google\.(com|[a-z]{2}|co\.uk|com\.au|co\.in|co\.nz|co\.jp)$/.test(host)) return "google"
  for (const [domain, name] of [
    ["bing.com", "bing"],
    ["duckduckgo.com", "duckduckgo"],
    ["yahoo.com", "yahoo"],
    ["ecosia.org", "ecosia"],
    ["search.brave.com", "brave"],
    ["instagram.com", "instagram"],
    ["facebook.com", "facebook"],
    ["tiktok.com", "tiktok"],
    ["pinterest.com", "pinterest"],
    ["reddit.com", "reddit"],
    ["youtube.com", "youtube"],
    ["t.co", "x"],
    ["x.com", "x"],
  ])
    if (matches(domain!)) return name!
  return host
}

export function buildOrderAttribution(
  url: URL,
  documentReferrer: string,
  now = Date.now()
): OrderAttribution | undefined {
  const metaOrigin = url.pathname === "/checkout/meta" ? url.searchParams.get("cart_origin") : null
  const metaSource = metaOrigin && ["facebook", "instagram", "meta_shops"].includes(metaOrigin) ? metaOrigin : null
  // Checkout returns and arbitrary paths can contain capabilities or personal information.
  if (url.pathname.startsWith("/checkout") && !metaSource) return undefined
  if (
    url.pathname !== "/checkout/meta" &&
    [...url.searchParams.keys()].some((key) =>
      ["session_id", "products", "coupon", "recovery_unavailable"].includes(key.toLowerCase())
    )
  )
    return undefined

  let referrerHost: string | null = null
  try {
    const referrer = new URL(documentReferrer)
    if (
      ["https:", "http:"].includes(referrer.protocol) &&
      !referrer.username &&
      !referrer.password &&
      referrer.origin !== url.origin &&
      referrer.hostname !== "stripe.com" &&
      !referrer.hostname.endsWith(".stripe.com") &&
      orderAttributionSchema.shape.referrerHost.safeParse(referrer.hostname).success
    )
      referrerHost = referrer.hostname
  } catch {
    // Referrers are optional and browser supplied; a malformed one is not a new source.
  }

  const utmSource = label(url.searchParams.get("utm_source"))
  const utmMedium = label(url.searchParams.get("utm_medium"))
  const utmCampaign = label(url.searchParams.get("utm_campaign"))
  const searchAdSource =
    url.searchParams.has("gclid") || url.searchParams.has("dclid")
      ? "google"
      : url.searchParams.has("msclkid")
        ? "bing"
        : null
  const campaign = Boolean(utmSource || utmMedium || utmCampaign || searchAdSource)
  let channel = classifyStoreVisitSource(url, referrerHost ? `https://${referrerHost}` : "")
  const source =
    utmSource?.toLowerCase() ?? searchAdSource ?? metaSource ?? (referrerHost ? platform(referrerHost) : null)
  if (campaign && channel === "direct" && source) channel = "referral"

  const result = orderAttributionSchema.safeParse({
    version: 1,
    capturedAt: new Date(now).toISOString(),
    channel,
    source,
    referrerHost,
    utmSource,
    utmMedium,
    utmCampaign,
    landingPath: url.pathname,
    method: campaign ? "campaign" : metaSource ? "meta_checkout" : referrerHost ? "referrer" : "direct",
  })
  return result.success ? result.data : undefined
}
