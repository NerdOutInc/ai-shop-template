import { describe, expect, it } from "vitest"

import { readPublicArtworkLocation } from "./read-public-artwork-location"

describe("public artwork location", () => {
  const pathname = `published-artwork/v1/${"a".repeat(64)}.webp`
  const url = `https://catalog.public.blob.vercel-storage.com/${pathname}`

  it("recognizes only a content addressed public derivative", () => {
    expect(readPublicArtworkLocation(url)).toEqual({
      url,
      hostname: "catalog.public.blob.vercel-storage.com",
      pathname,
      sha256: "a".repeat(64),
    })
  })

  it.each([
    null,
    "/api/admin/assets/123",
    `${url}?download=1`,
    `${url}#secret`,
    ` ${url}`,
    url.replace("https:", "http:"),
    url.replace(".public.", ".private."),
    url.replace("/published-artwork/v1/", "/concepts/"),
    url.replace(".webp", ".png"),
    url.replace("https://", "https://user:password@"),
    url.replace(".com/", ".com:8443/"),
  ])("rejects unsupported asset location %s", (value) => {
    expect(readPublicArtworkLocation(value)).toBeNull()
  })
})
