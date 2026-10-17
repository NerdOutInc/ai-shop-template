import type { HeroRect } from "./weekly-hero-schema"

export function findHeroLinkSpace(rectangles: readonly HeroRect[], kind: "desktop" | "mobile"): HeroRect | null {
  const left = kind === "desktop" ? 25 : 0
  const right = kind === "desktop" ? 75 : 100
  for (const size of [10, 6, 2]) {
    for (let y = 0; y + size <= 100; y += 2) {
      for (let x = left; x + size <= right; x += 2) {
        if (rectangles.every((r) => x + size <= r.x || x >= r.x + r.width || y + size <= r.y || y >= r.y + r.height))
          return { x, y, width: size, height: size }
      }
    }
  }
  return null
}
