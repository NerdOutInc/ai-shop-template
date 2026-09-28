// @vitest-environment node
import "../../../test/configured-store"
import { storeConfig } from "@/lib/store-config"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { subscribeToDrops } from "./subscribe-to-drops.server"

const { getPublicRequestIdentity, getDropSignupStore, store } = vi.hoisted(() => ({
  getPublicRequestIdentity: vi.fn(),
  getDropSignupStore: vi.fn(),
  store: { allowRequest: vi.fn(), subscribe: vi.fn() },
}))
vi.mock("server-only", () => ({}))
vi.mock("./get-public-request-identity.server", () => ({ getPublicRequestIdentity }))
vi.mock("./get-drop-signup-store.server", () => ({ getDropSignupStore }))

const identity = { subject: "2001:db8:1:2::/64", limit: 5, address: "2001:db8:1:2::7" }

beforeEach(() => {
  vi.resetAllMocks()
  getPublicRequestIdentity.mockResolvedValue(identity)
  getDropSignupStore.mockReturnValue(store)
  store.allowRequest.mockResolvedValue(true)
  store.subscribe.mockResolvedValue(undefined)
})
afterEach(() => vi.restoreAllMocks())

describe("subscribeToDrops", () => {
  it("does not collect customer email before store policies are approved", async () => {
    storeConfig.policies.published = false
    await expect(subscribeToDrops({ email: "customer@example.com", source: "footer" })).resolves.toBe("unavailable")
    expect(getPublicRequestIdentity).not.toHaveBeenCalled()
    expect(store.subscribe).not.toHaveBeenCalled()
  })

  // The lie is the point: a bot that is told "saved" learns nothing, and costs neither a header read
  // nor a database round trip.
  it("tells a filled honeypot it worked, and does nothing at all", async () => {
    await expect(
      subscribeToDrops({ email: "bot@example.com", source: "footer", company: "Acme Rope Co" })
    ).resolves.toBe("saved")
    expect(getPublicRequestIdentity).not.toHaveBeenCalled()
    expect(getDropSignupStore).not.toHaveBeenCalled()
  })

  it("treats an empty honeypot as a person", async () => {
    await expect(subscribeToDrops({ email: "shopper@example.com", source: "footer", company: "" })).resolves.toBe(
      "saved"
    )
    expect(store.subscribe).toHaveBeenCalledTimes(1)
  })

  it("refuses a caller it cannot identify before touching the store", async () => {
    getPublicRequestIdentity.mockResolvedValue(null)
    await expect(subscribeToDrops({ email: "shopper@example.com", source: "footer" })).resolves.toBe("unidentified")
    expect(getDropSignupStore).not.toHaveBeenCalled()
    expect(store.allowRequest).not.toHaveBeenCalled()
    expect(store.subscribe).not.toHaveBeenCalled()
  })

  it("writes nothing for a caller who is over the limit", async () => {
    store.allowRequest.mockResolvedValue(false)
    await expect(subscribeToDrops({ email: "shopper@example.com", source: "footer" })).resolves.toBe("rate-limited")
    expect(store.allowRequest).toHaveBeenCalledWith(identity.subject, identity.limit)
    expect(store.subscribe).not.toHaveBeenCalled()
  })

  it("counts the request, then saves the normalized address with where it came from", async () => {
    await expect(subscribeToDrops({ email: "  Shopper@Example.COM ", source: "design-of-the-week" })).resolves.toBe(
      "saved"
    )
    expect(store.allowRequest).toHaveBeenCalledWith(identity.subject, identity.limit)
    expect(store.subscribe).toHaveBeenCalledWith("shopper@example.com", "design-of-the-week", identity.address)
    expect(store.allowRequest.mock.invocationCallOrder[0]).toBeLessThan(store.subscribe.mock.invocationCallOrder[0]!)
  })

  // A driver error can quote the statement's parameters, and the parameter here is somebody's address.
  it("reports storage trouble without logging what went wrong", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    store.subscribe.mockRejectedValue(new Error("duplicate key shopper@example.com"))
    await expect(subscribeToDrops({ email: "shopper@example.com", source: "footer" })).resolves.toBe("unavailable")
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith("Drop signup unavailable", { reason: "storage" })
    expect(JSON.stringify(warn.mock.calls)).not.toContain("shopper@example.com")
  })

  it("reports an unconfigured store the same way", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    getDropSignupStore.mockImplementation(() => {
      throw new Error("Drop signups are not configured")
    })
    await expect(subscribeToDrops({ email: "shopper@example.com", source: "footer" })).resolves.toBe("unavailable")
  })
})
