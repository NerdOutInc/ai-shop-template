// @vitest-environment node
import "../../../../../test/configured-store"
import { storeConfig } from "@/lib/store-config"
import { beforeEach, expect, it, vi } from "vitest"
import { POST } from "./route"

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  lookup: vi.fn(),
  read: vi.fn(),
  unsubscribe: vi.fn(),
  erase: vi.fn(),
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/env", () => ({ env: {} }))
vi.mock("@/lib/get-site-url", () => ({ getSiteUrl: () => new URL("https://store.example") }))
vi.mock("@/features/admin/get-admin-actor.server", () => ({ getAdminActor: mocks.actor }))
vi.mock("@/features/drop-emails/get-drop-email-pool.server", () => ({ getDropEmailPool: () => ({}) }))
vi.mock("@/features/drop-signup/get-drop-signup-store.server", () => ({
  getDropSignupStore: () => ({ unsubscribe: mocks.unsubscribe }),
}))
vi.mock("@/features/subscribers/subscriber-admin-store.server", () => ({
  SubscriberAdminStore: class {
    lookup = mocks.lookup
    readById = mocks.read
    erase = mocks.erase
  },
}))
const id = "00000000-0000-4000-8000-000000000001"
const request = (body: unknown, origin: string | null = "https://store.example") =>
  new Request("https://store.example/api/admin/subscribers", {
    method: "POST",
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.actor.mockResolvedValue({ userId: "owner" })
  mocks.lookup.mockResolvedValue(null)
  mocks.read.mockResolvedValue(null)
  mocks.unsubscribe.mockResolvedValue(undefined)
  mocks.erase.mockResolvedValue({ status: "erased" })
})
it.each([null, "https://foreign.example"])("rejects origin %s before private reads", async (origin) => {
  expect((await POST(request({ action: "lookup", email: "shopper@example.com" }, origin))).status).toBe(403)
  expect(mocks.actor).not.toHaveBeenCalled()
  expect(mocks.lookup).not.toHaveBeenCalled()
})
it("checks current membership on every lookup and mutation", async () => {
  mocks.actor.mockResolvedValue(null)
  for (const action of [
    { action: "lookup", email: "shopper@example.com" },
    { action: "unsubscribe", id },
    { action: "preview", id },
    {
      action: "erase",
      email: "shopper@example.com",
      preview: { id, updatedAt: "snapshot", deliveries: 0, confirmations: 0 },
    },
  ]) {
    const response = await POST(request(action))
    expect(response.status).toBe(401)
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(response.headers.get("referrer-policy")).toBe("no-referrer")
    expect(response.headers.get("x-robots-tag")).toContain("noindex")
  }
  expect(mocks.lookup).not.toHaveBeenCalled()
  expect(mocks.unsubscribe).not.toHaveBeenCalled()
})
it("normalizes one exact email and uses the shared unsubscribe with identity readback", async () => {
  expect((await POST(request({ action: "lookup", email: " Shopper+gear@Example.com " }))).status).toBe(200)
  expect(mocks.lookup).toHaveBeenCalledWith("shopper+gear@example.com")
  expect((await POST(request({ action: "unsubscribe", id }))).status).toBe(200)
  expect(mocks.unsubscribe).toHaveBeenCalledWith(id)
  expect(mocks.read).toHaveBeenCalledWith(id)
})
it.each([
  { action: "lookup", email: "%" },
  { action: "lookup", email: "a@example.com", limit: 100 },
  { action: "unsubscribe", id: "junk" },
])("rejects invalid / browsing request %j", async (body) => {
  expect((await POST(request(body))).status).toBe(400)
  expect(mocks.lookup).not.toHaveBeenCalled()
  expect(mocks.unsubscribe).not.toHaveBeenCalled()
})
it("bounds bodies and reports an uncertain write without leaking storage errors", async () => {
  expect((await POST(request({ action: "lookup", email: "x".repeat(2100) }))).status).toBe(413)
  mocks.unsubscribe.mockRejectedValue(new Error("private email/token/database details"))
  const response = await POST(request({ action: "unsubscribe", id }))
  expect(response.status).toBe(503)
  expect(await response.text()).not.toContain("private email/token/database details")
})

it("returns a fresh preview on a stale commit and a busy answer without calling unsubscribe", async () => {
  const preview = { id, updatedAt: "snapshot", deliveries: 1, confirmations: 2 }
  mocks.erase.mockResolvedValue({
    status: "stale",
    subscriber: { id, updatedAt: "fresh", deliveries: 1, confirmations: 3 },
  })
  const response = await POST(request({ action: "erase", email: "shopper@example.com", preview }))
  expect(response.status).toBe(409)
  expect(await response.json()).toMatchObject({ status: "stale", subscriber: { updatedAt: "fresh", confirmations: 3 } })
  expect(mocks.erase).toHaveBeenCalledWith(preview, "shopper@example.com")
  mocks.erase.mockResolvedValue({ status: "busy" })
  expect((await POST(request({ action: "erase", email: "shopper@example.com", preview }))).status).toBe(409)
  expect(mocks.unsubscribe).not.toHaveBeenCalled()
})

it("denies a never-enabled undisclosed list after checking membership", async () => {
  storeConfig.features.dropSignup = false
  storeConfig.privacy.retainedDropSubscribers = false
  expect((await POST(request({ action: "lookup", email: "shopper@example.com" }))).status).toBe(503)
  expect(mocks.lookup).not.toHaveBeenCalled()
})
