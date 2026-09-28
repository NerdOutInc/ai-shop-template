import { describe, expect, it } from "vitest"

import { isPublicBlobHost } from "./is-public-blob-host"

describe("isPublicBlobHost", () => {
  it.each(["store123.public.blob.vercel-storage.com", "product-images.public.blob.vercel-storage.com"])(
    "accepts a public store hostname: %s",
    (host) => expect(isPublicBlobHost(host)).toBe(true)
  )

  it.each([
    undefined,
    "",
    "https://store123.public.blob.vercel-storage.com",
    "store123.private.blob.vercel-storage.com",
    "store123.public.blob.vercel-storage.com.evil.test",
    "nested.store123.public.blob.vercel-storage.com",
    "store123.public.blob.vercel-storage.com:443",
    "-store123.public.blob.vercel-storage.com",
    "store123-.public.blob.vercel-storage.com",
    `${"a".repeat(64)}.public.blob.vercel-storage.com`,
  ])("rejects an invalid or non-public host: %s", (host) => {
    expect(isPublicBlobHost(host)).toBe(false)
  })
})
