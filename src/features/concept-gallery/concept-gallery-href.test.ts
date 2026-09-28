import { describe, expect, it } from "vitest"

import { conceptGalleryHref } from "./concept-gallery-href"

describe("conceptGalleryHref", () => {
  it("preserves complete filters and personal scope across pages", () => {
    const url = new URL(
      conceptGalleryHref(
        {
          search: "#149 & botanical",
          collectionId: "original shirts",
          family: "characters",
          productModelId: "next-level-6210",
          status: "draft",
          favoritesOnly: true,
        },
        2
      ),
      "https://example.test"
    )
    expect(url.pathname).toBe("/admin/concepts")
    expect(Object.fromEntries(url.searchParams)).toEqual({
      search: "#149 & botanical",
      collection: "original shirts",
      family: "characters",
      model: "next-level-6210",
      status: "draft",
      favorites: "1",
      page: "2",
    })
  })
})
