import { inject, track } from "@vercel/analytics"

import { isPrivateAppPath } from "@/lib/is-private-app-path"

import { getStoreVisitSource } from "./get-store-visit-source"
import { sanitizeAnalyticsEvent } from "./sanitize-analytics-event"

type StoreEvent =
  | { name: "product_viewed" | "add_to_cart"; productId: string }
  | { name: "begin_checkout"; subtotalUsd: number }
  | { name: "purchase"; totalUsd: number }

/** Returns whether the SDK call ran, not whether Vercel received it. */
export function trackStoreEvent(event: StoreEvent): boolean {
  if (typeof window === "undefined" || isPrivateAppPath(window.location.pathname)) return false
  try {
    const source = getStoreVisitSource()
    // Pro permits two properties. Copy only these fields, never arbitrary order data.
    const properties =
      "productId" in event
        ? { source, product_id: event.productId }
        : "subtotalUsd" in event
          ? { source, subtotal_usd: event.subtotalUsd }
          : { source, total_usd: event.totalUsd }
    // A product effect or quick status response can precede the lazy Next adapter.
    // Initialize its official SDK queue and sanitizer before enqueueing any event.
    inject(
      {
        disableAutoTrack: true,
        beforeSend: sanitizeAnalyticsEvent,
        framework: "next",
        basePath: process.env.NEXT_PUBLIC_VERCEL_OBSERVABILITY_BASEPATH,
      },
      process.env.NEXT_PUBLIC_VERCEL_OBSERVABILITY_CLIENT_CONFIG
    )
    track(event.name, properties)
    return true
  } catch {
    return false
  }
}
