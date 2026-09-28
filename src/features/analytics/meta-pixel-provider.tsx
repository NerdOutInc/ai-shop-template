"use client"

import { usePathname } from "next/navigation"
import { useEffect } from "react"

import { metaPixel } from "./meta-pixel"
import { useMetaPixel } from "./use-meta-pixel"

export function MetaPixelProvider() {
  const pathname = usePathname()
  const { ready } = useMetaPixel()

  useEffect(() => {
    const controller = new AbortController()
    // Keep runtime activation flags out of prerendered HTML; failures leave tracking off.
    void fetch("/api/analytics/meta-config", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return
        const configuration: unknown = await response.json()
        if (
          !controller.signal.aborted &&
          configuration &&
          typeof configuration === "object" &&
          "enabled" in configuration &&
          typeof configuration.enabled === "boolean" &&
          "pixelId" in configuration &&
          typeof configuration.pixelId === "string" &&
          "canonicalOrigin" in configuration &&
          typeof configuration.canonicalOrigin === "string"
        ) {
          metaPixel.configure({
            enabled: configuration.enabled,
            pixelId: configuration.pixelId,
            canonicalOrigin: configuration.canonicalOrigin,
          })
        }
      })
      .catch(() => {
        // Measurement configuration is optional; shopping remains available.
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    metaPixel.pageView(pathname)
  }, [pathname, ready])

  return null
}
