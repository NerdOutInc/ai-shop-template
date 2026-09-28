// @vitest-environment node
import { storeConfig } from "@/lib/store-config"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { POST } from "./route"

const { subscribeToDrops, env } = vi.hoisted(() => ({
  subscribeToDrops: vi.fn(),
  env: { VERCEL_ENV: "production", VERCEL_URL: "preview.vercel.app" },
}))
vi.mock("server-only", () => ({}))
vi.mock("@/features/drop-signup/subscribe-to-drops.server", () => ({ subscribeToDrops }))
vi.mock("@/lib/env", () => ({ env }))
vi.mock("@/lib/get-site-url", () => ({ getSiteUrl: () => new URL("https://store.example") }))

function request(
  origin: string | null = "https://store.example",
  body: unknown = { email: "shopper@example.com", source: "design-of-the-week" },
  contentType: string | null = "application/json"
) {
  return new Request("http://0.0.0.0:3000/api/drop-signup", {
    method: "POST",
    headers: { ...(origin ? { origin } : {}), ...(contentType ? { "content-type": contentType } : {}) },
    body: JSON.stringify(body),
  })
}
beforeEach(() => {
  storeConfig.features.dropSignup = true
  vi.clearAllMocks()
  env.VERCEL_ENV = "production"
  subscribeToDrops.mockResolvedValue("saved")
})

describe("drop signup route", () => {
  it("takes a sign-up and never lets it be cached", async () => {
    const result = await POST(request())
    expect(result.status).toBe(200)
    expect(await result.json()).toEqual({ subscribed: true })
    expect(subscribeToDrops).toHaveBeenCalledWith({ email: "shopper@example.com", source: "design-of-the-week" })
    expect(result.headers.get("cache-control")).toContain("no-store")
    expect(result.headers.get("x-robots-tag")).toBeTruthy()
  })

  // CSRF protection for browsers. It buys nothing against curl, which is why the rate limit exists.
  it.each([null, "null", "https://foreign.example"])("denies origin %s before reading a body", async (origin) => {
    expect((await POST(request(origin))).status).toBe(403)
    expect(subscribeToDrops).not.toHaveBeenCalled()
  })

  it("permits the deployment origin only in a configured Vercel preview", async () => {
    expect((await POST(request("https://preview.vercel.app"))).status).toBe(403)
    env.VERCEL_ENV = "preview"
    expect((await POST(request("https://preview.vercel.app"))).status).toBe(200)
  })

  it("refuses anything that is not small JSON", async () => {
    expect((await POST(request("https://store.example", {}, "text/plain"))).status).toBe(415)
    const large = new Request("http://0.0.0.0:3000/api/drop-signup", {
      method: "POST",
      headers: { origin: "https://store.example", "content-type": "application/json" },
      body: JSON.stringify({ email: `${"a".repeat(4000)}@example.com`, source: "footer" }),
    })
    expect((await POST(large)).status).toBe(413)
    expect(subscribeToDrops).not.toHaveBeenCalled()
  })

  it.each([
    ["no address", { source: "footer" }],
    ["a malformed address", { email: "not-an-address", source: "footer" }],
    ["an unknown surface", { email: "shopper@example.com", source: "billboard" }],
    ["an unexpected field", { email: "shopper@example.com", source: "footer", marketing: true }],
    ["nothing at all", null],
  ])("rejects %s before any write", async (_label, body) => {
    expect((await POST(request("https://store.example", body))).status).toBe(400)
    expect(subscribeToDrops).not.toHaveBeenCalled()
  })

  it("asks a flooder to wait rather than silently dropping them", async () => {
    subscribeToDrops.mockResolvedValue("rate-limited")
    const result = await POST(request())
    expect(result.status).toBe(429)
    expect(await result.json()).toEqual({ error: "That's a few tries in a row. Give it a few minutes." })
  })

  it("refuses a request it cannot attribute, rather than allowing it", async () => {
    subscribeToDrops.mockResolvedValue("unidentified")
    expect((await POST(request())).status).toBe(400)
  })

  it("reports a storage outage as retryable without exposing details", async () => {
    subscribeToDrops.mockResolvedValue("unavailable")
    const result = await POST(request())
    expect(result.status).toBe(503)
    expect(await result.text()).not.toContain("database")
  })
})

it("returns 404 when signup is disabled without consuming the body or collecting data", async () => {
  storeConfig.features.dropSignup = false
  const input = request()
  const response = await POST(input)
  expect(response.status).toBe(404)
  expect(response.headers.get("cache-control")).toContain("no-store")
  expect(input.bodyUsed).toBe(false)
  expect(subscribeToDrops).not.toHaveBeenCalled()
})
