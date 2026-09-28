"use client"

import dynamic from "next/dynamic"
import { usePathname } from "next/navigation"
import { useEffect } from "react"

import { getStoreVisitSource } from "@/features/analytics/get-store-visit-source"
import { googleTag } from "@/features/analytics/google-tag"
import { metaPixel } from "@/features/analytics/meta-pixel"
import { sanitizeAnalyticsEvent } from "@/features/analytics/sanitize-analytics-event"
import { getOrderAttribution } from "@/features/attribution/get-order-attribution"
import { isPrivateAppPath } from "@/lib/is-private-app-path"
import { storeConfig } from "@/lib/store-config"

const Analytics = dynamic(() => import("@vercel/analytics/next").then((module) => module.Analytics), { ssr: false })

export function StoreAnalytics() {
  const pathname = usePathname()
  const privatePage = isPrivateAppPath(pathname)
  const enabled = storeConfig.configured && storeConfig.policies.published && storeConfig.commerce.shippingConfirmed
  useEffect(() => {
    if (!enabled || privatePage) return
    getStoreVisitSource()
    getOrderAttribution()
    const meta = metaPixel.subscribe(getOrderAttribution)
    const google = googleTag.subscribe(getOrderAttribution)
    window.addEventListener("storage", getOrderAttribution)
    window.addEventListener("focus", getOrderAttribution)
    return () => {
      meta()
      google()
      window.removeEventListener("storage", getOrderAttribution)
      window.removeEventListener("focus", getOrderAttribution)
    }
  }, [enabled, privatePage, pathname])
  if (!enabled || privatePage) return null
  return <Analytics beforeSend={sanitizeAnalyticsEvent} />
}
