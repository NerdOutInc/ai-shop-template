import type { CSSProperties } from "react"

/** The 50vw floor keeps the panorama covering extra-wide windows. */
export function getWeeklyHeroLayout(): CSSProperties {
  return { "--weekly-hero-width": "min(100vw, max(50vw, min(1536px, 120svh)))" } as CSSProperties
}
