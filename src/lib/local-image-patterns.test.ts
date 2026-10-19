import { hasLocalMatch } from "next/dist/shared/lib/match-local-pattern"
import { expect, it } from "vitest"
import { localImagePatterns } from "./local-image-patterns"

it("keeps public assets and custom logo paths optimizable", () => {
  const patterns = localImagePatterns("/brand/mark[1].png?v=2")
  for (const src of ["/images/card.webp", "/_next/static/media/photo.abc.png", "/brand/mark[1].png?v=2"])
    expect(hasLocalMatch(patterns, src)).toBe(true)
  expect(hasLocalMatch(patterns, "/brand/mark1.png?v=2")).toBe(false)
})

it("rejects optimizer requests for revocable hero assets even when called directly", () => {
  const patterns = localImagePatterns("/logo.png")
  for (const src of [
    "/api/weekly-hero/id",
    "/api/admin/weekly-heroes/assets/id",
    "/%61pi/weekly-hero/id",
    "/api%2fweekly-hero/id",
    "/images/../api/weekly-hero/id",
    "/images/%2e%2e/api/weekly-hero/id",
  ])
    expect(hasLocalMatch(patterns, src)).toBe(false)
  for (const src of ["/api/weekly-hero/id", "/%2561pi/weekly-hero/id"])
    expect(() => localImagePatterns(src)).toThrow("public static file")
})
