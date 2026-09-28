import { beforeEach, describe, expect, it, vi } from "vitest"

const settings = vi.hoisted(() => ({
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  GOOGLE_TAG_ENABLED: "true",
  GOOGLE_TAG_ID: "GT-TEST1234",
  origin: "https://example.com",
}))
vi.mock("@/lib/env", () => ({ env: settings }))
vi.mock("@/lib/get-site-url", () => ({ getSiteUrl: () => new URL(settings.origin) }))

import { GET } from "./route"

describe("Google tag configuration", () => {
  beforeEach(() => {
    Object.assign(settings, {
      NODE_ENV: "production",
      VERCEL_ENV: "production",
      GOOGLE_TAG_ENABLED: "true",
      GOOGLE_TAG_ID: "GT-TEST1234",
      origin: "https://example.com",
    })
  })

  it("exposes only public configuration for the explicitly enabled production store", async () => {
    const response = GET()
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(await response.json()).toEqual({
      enabled: true,
      tagId: "GT-TEST1234",
      canonicalOrigin: "https://example.com",
    })
  })

  it.each([
    { VERCEL_ENV: "preview" },
    { VERCEL_ENV: "development" },
    { VERCEL_ENV: "" },
    { NODE_ENV: "development" },
    { GOOGLE_TAG_ENABLED: "" },
    { GOOGLE_TAG_ENABLED: "false" },
    { GOOGLE_TAG_ENABLED: "TRUE" },
    { GOOGLE_TAG_ID: "" },
    { GOOGLE_TAG_ID: "not-a-pixel" },
    { GOOGLE_TAG_ID: "12345<script>" },
    { origin: "http://example.com" },
  ])("fails closed for $NODE_ENV $VERCEL_ENV $GOOGLE_TAG_ENABLED $GOOGLE_TAG_ID $origin", async (override) => {
    Object.assign(settings, override)
    expect(await GET().json()).toEqual({ enabled: false, tagId: "", canonicalOrigin: settings.origin })
  })
})
