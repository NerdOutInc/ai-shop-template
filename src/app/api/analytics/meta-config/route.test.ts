import { beforeEach, describe, expect, it, vi } from "vitest"

const settings = vi.hoisted(() => ({
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  META_PIXEL_ENABLED: "true",
  META_PIXEL_ID: "123456789012345",
  origin: "https://example.com",
}))
vi.mock("@/lib/env", () => ({ env: settings }))
vi.mock("@/lib/get-site-url", () => ({ getSiteUrl: () => new URL(settings.origin) }))

import { GET } from "./route"

describe("Meta Pixel configuration", () => {
  beforeEach(() => {
    Object.assign(settings, {
      NODE_ENV: "production",
      VERCEL_ENV: "production",
      META_PIXEL_ENABLED: "true",
      META_PIXEL_ID: "123456789012345",
      origin: "https://example.com",
    })
  })

  it("exposes only public configuration for the explicitly enabled production store", async () => {
    const response = GET()
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(await response.json()).toEqual({
      enabled: true,
      pixelId: "123456789012345",
      canonicalOrigin: "https://example.com",
    })
  })

  it.each([
    { VERCEL_ENV: "preview" },
    { VERCEL_ENV: "development" },
    { VERCEL_ENV: "" },
    { NODE_ENV: "development" },
    { META_PIXEL_ENABLED: "" },
    { META_PIXEL_ENABLED: "false" },
    { META_PIXEL_ENABLED: "TRUE" },
    { META_PIXEL_ID: "" },
    { META_PIXEL_ID: "not-a-pixel" },
    { META_PIXEL_ID: "12345<script>" },
    { origin: "http://example.com" },
  ])("fails closed for $NODE_ENV $VERCEL_ENV $META_PIXEL_ENABLED $META_PIXEL_ID $origin", async (override) => {
    Object.assign(settings, override)
    expect(await GET().json()).toEqual({ enabled: false, pixelId: "", canonicalOrigin: settings.origin })
  })
})
