// @vitest-environment node
import "../../../../test/configured-store"
import { storeConfig } from "@/lib/store-config"
import { beforeEach, expect, it, vi } from "vitest"
import { POST } from "./route"
const { store, identity, env } = vi.hoisted(() => ({
  store: { confirm: vi.fn(), allowRequest: vi.fn() },
  identity: vi.fn(),
  env: { VERCEL_ENV: "production" },
}))
vi.mock("server-only", () => ({}))
vi.mock("@/features/drop-signup/get-drop-signup-store.server", () => ({ getDropSignupStore: () => store }))
vi.mock("@/features/drop-signup/get-public-request-identity.server", () => ({ getPublicRequestIdentity: identity }))
vi.mock("@/lib/get-site-url", () => ({ getSiteUrl: () => new URL("https://shop.example") }))
vi.mock("@/lib/env", () => ({ env }))
const request = (origin = "https://shop.example", token = "a".repeat(64)) =>
  new Request("https://shop.example/api/drop-confirm", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ token }),
  })
beforeEach(() => {
  env.VERCEL_ENV = "production"
  vi.resetAllMocks()
  identity.mockResolvedValue({ subject: "ip", limit: 5 })
  store.allowRequest.mockResolvedValue(true)
  store.confirm.mockResolvedValue("confirmed")
})
it("confirms only a bounded same-origin POST without exposing tokens in its response", async () => {
  const response = await POST(request())
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ status: "confirmed" })
  expect(response.headers.get("referrer-policy")).toBe("no-referrer")
  expect(response.headers.get("cache-control")).toContain("no-store")
})
it("denies cross-origin, invalid and rate-limited requests before confirmation", async () => {
  expect((await POST(request("https://foreign.example"))).status).toBe(403)
  expect((await POST(request("https://shop.example", "invalid"))).status).toBe(410)
  store.allowRequest.mockResolvedValue(false)
  expect((await POST(request())).status).toBe(429)
  expect(store.confirm).not.toHaveBeenCalled()
})
it("distinguishes an expired capability from temporary storage trouble and never logs it", async () => {
  store.confirm.mockResolvedValue("expired")
  expect((await POST(request())).status).toBe(410)
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  store.confirm.mockRejectedValue(new Error("address/token must stay private"))
  expect((await POST(request())).status).toBe(503)
  expect(warn).toHaveBeenCalledWith("Drop confirmation unavailable", { reason: "storage" })
})

it("does not consume production capabilities from previews", async () => {
  env.VERCEL_ENV = "preview"
  expect((await POST(request())).status).toBe(503)
  expect(store.confirm).not.toHaveBeenCalled()
})

it("denies an unconfigured or closed undisclosed list before storage", async () => {
  storeConfig.configured = false
  expect((await POST(request())).status).toBe(503)
  expect(store.confirm).not.toHaveBeenCalled()
})
