import type { CSSProperties } from "react"

/** Size the central composition relative to the viewport, without assuming a store header height.
 * The 50vw floor keeps the surrounding 3:1 panorama covering extra-wide windows. */
export function getWeeklyHeroLayout(desktopFraction = 1, mobileFraction = 1) {
  const width = (scale: number) =>
    `min(${scale * 100}vw, max(${scale * 50}vw, min(${scale * 1536}px, ${scale * 120}svh)))`
  return {
    frameStyle: { "--weekly-hero-width": width(1) } as CSSProperties,
    sizes: `(max-width: 700px) ${mobileFraction * 100}vw, ${width(desktopFraction)}`,
  }
}
