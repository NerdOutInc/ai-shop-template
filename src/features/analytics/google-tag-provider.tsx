"use client"

import { usePathname } from "next/navigation"
import { useEffect } from "react"

import { googleTag } from "./google-tag"
import { useGoogleTag } from "./use-google-tag"

export function GoogleTagProvider() {
  const pathname = usePathname()
  const { ready } = useGoogleTag()
  useEffect(() => {
    const controller = new AbortController()
    void fetch("/api/analytics/google-config", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return
        const value: unknown = await response.json()
        if (
          !controller.signal.aborted &&
          value &&
          typeof value === "object" &&
          "enabled" in value &&
          typeof value.enabled === "boolean" &&
          "tagId" in value &&
          typeof value.tagId === "string" &&
          "canonicalOrigin" in value &&
          typeof value.canonicalOrigin === "string"
        )
          googleTag.configure({ enabled: value.enabled, tagId: value.tagId, canonicalOrigin: value.canonicalOrigin })
      })
      .catch(() => {
        /* Configuration failures leave Google off. */
      })
    return () => controller.abort()
  }, [])
  useEffect(() => {
    googleTag.pageView(pathname)
  }, [pathname, ready])
  return null
}
