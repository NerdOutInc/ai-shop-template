import { expect, it } from "vitest"
import { findHeroLinkSpace } from "./find-hero-link-space"
it("requires room before adding a destination instead of placing an overlapping default", () => {
  expect(findHeroLinkSpace([{ x: 0, y: 0, width: 100, height: 100 }], "mobile")).toBeNull()
  expect(findHeroLinkSpace([{ x: 25, y: 0, width: 50, height: 100 }], "desktop")).toBeNull()
})
