import { beforeEach, describe, expect, it, vi } from "vitest"

import { getSiteUrl } from "./get-site-url"

vi.mock("server-only", () => ({}))
const config = vi.hoisted(() => ({ NEXT_PUBLIC_SITE_URL: undefined as string | undefined }))
vi.mock("./env", () => ({ env: config }))
beforeEach(() => {
  config.NEXT_PUBLIC_SITE_URL = undefined
})

describe("public site identity", () => {
  it("uses localhost before a store domain is configured", () => {
    expect(getSiteUrl().href).toBe("http://localhost:3000/")
  })
  it("uses only the configured origin, excluding incidental paths and parameters", () => {
    config.NEXT_PUBLIC_SITE_URL = "https://store.example/path?preview=yes#section"
    expect(getSiteUrl().href).toBe("https://store.example/")
  })
})
