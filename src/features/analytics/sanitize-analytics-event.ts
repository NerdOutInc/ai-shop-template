import type { BeforeSendEvent } from "@vercel/analytics"

import { isPrivateAppPath } from "@/lib/is-private-app-path"

export function sanitizeAnalyticsEvent(event: BeforeSendEvent): BeforeSendEvent | null {
  try {
    const url = new URL(event.url)
    if (isPrivateAppPath(url.pathname)) return null
    // This reference can retrieve order status; it must never reach analytics.
    url.searchParams.delete("session_id")
    url.searchParams.delete("products")
    url.searchParams.delete("coupon")
    // The drop signup form's field names, in case a native submit ever puts them in a URL.
    url.searchParams.delete("email")
    url.searchParams.delete("company")
    return { ...event, url: url.toString() }
  } catch {
    return null
  }
}
