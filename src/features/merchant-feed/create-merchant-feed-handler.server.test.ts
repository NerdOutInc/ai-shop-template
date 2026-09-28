import { beforeEach, describe, expect, it, vi } from "vitest"

import { createMerchantFeed } from "./create-merchant-feed"
import { createMerchantFeedHandler } from "./create-merchant-feed-handler.server"
import { getMerchantProducts } from "./get-merchant-products.server"
import { logMerchantFeedFailure } from "./log-merchant-feed-failure.server"

vi.mock("./get-merchant-products.server", () => ({ getMerchantProducts: vi.fn() }))
vi.mock("./create-merchant-feed", () => ({ createMerchantFeed: vi.fn() }))
vi.mock("./log-merchant-feed-failure.server", () => ({ logMerchantFeedFailure: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/get-site-url", () => ({ getSiteUrl: () => new URL("https://example.com") }))
const config = vi.hoisted(() => ({
  indexable: true,
  passwords: {
    google: "test-google-feed-password-at-least-32" as string | undefined,
    meta: "test-meta-catalog-password-at-least-32" as string | undefined,
  },
}))
vi.mock("@/lib/is-indexable-site", () => ({ isIndexableSite: () => config.indexable }))
vi.mock("@/lib/env", () => ({
  env: {
    get GOOGLE_MERCHANT_FEED_PASSWORD() {
      return config.passwords.google
    },
    get META_CATALOG_FEED_PASSWORD() {
      return config.passwords.meta
    },
  },
}))

const usernames = { google: "google-merchant", meta: "meta-catalog" }

function credentials(username: string, password: string | undefined) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}

function authorizedRequest(destination: "google" | "meta") {
  return new Request(`https://example.com/feeds/${destination}`, {
    headers: { Authorization: credentials(usernames[destination], config.passwords[destination]) },
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  config.indexable = true
  config.passwords.google = "test-google-feed-password-at-least-32"
  config.passwords.meta = "test-meta-catalog-password-at-least-32"
  vi.mocked(getMerchantProducts).mockResolvedValue([])
  vi.mocked(createMerchantFeed).mockReturnValue('<?xml version="1.0"?><rss><channel /></rss>')
})

describe.each(["google", "meta"] as const)("%s merchant feed response", (destination) => {
  const GET = createMerchantFeedHandler(destination)
  const otherDestination = destination === "google" ? "meta" : "google"

  it("serves an authenticated empty catalog without exposing a shared cached response", async () => {
    const response = await GET(authorizedRequest(destination))
    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toBe("application/xml; charset=utf-8")
    expect(response.headers.get("Cache-Control")).toBe("private, no-store")
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex")
    expect(await response.text()).toContain("<channel />")
    expect(createMerchantFeed).toHaveBeenCalledExactlyOnceWith([], new URL("https://example.com"), destination)
  })

  it.each(["read", "serialization"])("returns an uncached retryable error on %s failure", async (failure) => {
    if (failure === "read") vi.mocked(getMerchantProducts).mockRejectedValue(new Error("private provider detail"))
    else
      vi.mocked(createMerchantFeed).mockImplementation(() => {
        throw new Error("private invalid snapshot")
      })
    const response = await GET(authorizedRequest(destination))
    expect(response.status).toBe(503)
    expect(response.headers.get("Cache-Control")).toBe("private, no-store")
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex")
    expect(response.headers.get("Retry-After")).toBe("300")
    expect(await response.text()).toBe("Product feed temporarily unavailable")
    expect(logMerchantFeedFailure).toHaveBeenCalledExactlyOnceWith(expect.any(Error), "route")
  })

  it("rejects cache-busted requests with absent or invalid credentials before any catalog work", async () => {
    const password = config.passwords[destination]!
    const headers = [
      undefined,
      "Bearer private-secret",
      "Basic invalid%%%",
      credentials("wrong-user", password),
      credentials(usernames[destination], "wrong-password"),
      credentials(usernames[destination], `x${password.slice(1)}`),
      credentials(usernames[destination], ""),
      `Basic ${"A".repeat(2048)}`,
    ]
    for (const [index, authorization] of headers.entries()) {
      const request = new Request(`https://example.com/feeds/${destination}?cacheBust=${index}&password=${password}`, {
        headers: authorization ? { authorization } : {},
      })
      const response = await GET(request)
      expect(response.status).toBe(404)
      expect(response.headers.get("Cache-Control")).toBe("private, no-store")
      expect(response.headers.get("X-Robots-Tag")).toBe("noindex")
      expect(await response.text()).toBe("")
    }
    expect(getMerchantProducts).not.toHaveBeenCalled()
    expect(createMerchantFeed).not.toHaveBeenCalled()
    expect(logMerchantFeedFailure).not.toHaveBeenCalled()
  })

  it("rejects the other destination's username and password before any catalog work", async () => {
    const headers = [
      credentials(usernames[otherDestination], config.passwords[otherDestination]),
      credentials(usernames[destination], config.passwords[otherDestination]),
      credentials(usernames[otherDestination], config.passwords[destination]),
    ]
    for (const authorization of headers) {
      const request = new Request(`https://example.com/feeds/${destination}`, { headers: { authorization } })
      expect((await GET(request)).status).toBe(404)
    }
    expect(getMerchantProducts).not.toHaveBeenCalled()
    expect(createMerchantFeed).not.toHaveBeenCalled()
  })

  it("fails closed without its configured password even when the other feed is configured", async () => {
    const request = authorizedRequest(destination)
    config.passwords[destination] = undefined
    expect((await GET(request)).status).toBe(404)
    expect((await GET(authorizedRequest(otherDestination))).status).toBe(404)
    expect(getMerchantProducts).not.toHaveBeenCalled()
  })

  it("rotates its password without changing access to the other feed", async () => {
    const oldRequest = authorizedRequest(destination)
    const otherRequest = authorizedRequest(otherDestination)
    config.passwords[destination] = `rotated-${config.passwords[destination]}`

    expect((await GET(oldRequest)).status).toBe(404)
    expect(getMerchantProducts).not.toHaveBeenCalled()
    expect((await GET(authorizedRequest(destination))).status).toBe(200)
    expect((await createMerchantFeedHandler(otherDestination)(otherRequest)).status).toBe(200)
  })

  it("revokes its password without revoking access to the other feed", async () => {
    const request = authorizedRequest(destination)
    const otherRequest = authorizedRequest(otherDestination)
    config.passwords[destination] = undefined

    expect((await GET(request)).status).toBe(404)
    expect(getMerchantProducts).not.toHaveBeenCalled()
    expect((await createMerchantFeedHandler(otherDestination)(otherRequest)).status).toBe(200)
  })

  it("accepts the case-insensitive Basic scheme used by HTTP clients", async () => {
    const request = authorizedRequest(destination)
    request.headers.set("Authorization", request.headers.get("Authorization")!.replace("Basic", "basic"))
    expect((await GET(request)).status).toBe(200)
  })

  it("keeps preview feeds unavailable without reading the production catalog", async () => {
    config.indexable = false
    const response = await GET(authorizedRequest(destination))
    expect(response.status).toBe(404)
    expect(response.headers.get("Cache-Control")).toBe("private, no-store")
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex")
    expect(getMerchantProducts).not.toHaveBeenCalled()
    expect(createMerchantFeed).not.toHaveBeenCalled()
  })
})
