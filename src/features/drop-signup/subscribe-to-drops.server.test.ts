// @vitest-environment node
import "../../../test/configured-store"
import { storeConfig } from "@/lib/store-config"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { subscribeToDrops } from "./subscribe-to-drops.server"

const {
  getPublicRequestIdentity,
  getDropSignupStore,
  store,
  readSignupConfirmationSetup,
  runSignupConfirmations,
  after,
} = vi.hoisted(() => ({
  readSignupConfirmationSetup: vi.fn(),
  runSignupConfirmations: vi.fn(),
  after: vi.fn(),
  getPublicRequestIdentity: vi.fn(),
  getDropSignupStore: vi.fn(),
  store: { allowRequest: vi.fn(), subscribe: vi.fn() },
}))
vi.mock("next/server", () => ({ after }))
vi.mock("./read-signup-confirmation-setup.server", () => ({ readSignupConfirmationSetup }))
vi.mock("./run-signup-confirmations.server", () => ({ runSignupConfirmations }))
vi.mock("server-only", () => ({}))
vi.mock("./get-public-request-identity.server", () => ({ getPublicRequestIdentity }))
vi.mock("./get-drop-signup-store.server", () => ({ getDropSignupStore }))

const identity = { subject: "2001:db8:1:2::/64", limit: 5, address: "2001:db8:1:2::7" }

beforeEach(() => {
  vi.resetAllMocks()
  storeConfig.features.dropSignup = true
  getPublicRequestIdentity.mockResolvedValue(identity)
  getDropSignupStore.mockReturnValue(store)
  store.allowRequest.mockResolvedValue(true)
  store.subscribe.mockResolvedValue(null)
  readSignupConfirmationSetup.mockReturnValue({
    sending: true,
    from: "Fixture Store <drops@example.com>",
    identityKey: "fixture-cron-secret",
  })
  runSignupConfirmations.mockResolvedValue({ sent: 1, errors: 0 })
})
afterEach(() => vi.restoreAllMocks())

describe("subscribeToDrops", () => {
  it("does not collect customer email when signup is disabled", async () => {
    storeConfig.features.dropSignup = false
    await expect(subscribeToDrops({ email: "customer@example.com", source: "footer" })).resolves.toBe("unavailable")
    expect(getPublicRequestIdentity).not.toHaveBeenCalled()
    expect(getDropSignupStore).not.toHaveBeenCalled()
  })

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
    expect(store.allowRequest).toHaveBeenCalledWith(identity.subject, identity.limit, "fixture-cron-secret")
    expect(store.subscribe).not.toHaveBeenCalled()
  })

  it("counts the request, then saves the normalized address with where it came from", async () => {
    await expect(subscribeToDrops({ email: "  Shopper@Example.COM ", source: "design-of-the-week" })).resolves.toBe(
      "saved"
    )
    expect(store.allowRequest).toHaveBeenCalledWith(identity.subject, identity.limit, "fixture-cron-secret")
    expect(store.subscribe).toHaveBeenCalledWith(
      "shopper@example.com",
      "design-of-the-week",
      identity.address,
      expect.objectContaining({ from: "Fixture Store <drops@example.com>", requestSubject: identity.subject })
    )
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
  it("does not write or mail while confirmation sending is disabled", async () => {
    readSignupConfirmationSetup.mockReturnValue({ sending: false })
    expect(await subscribeToDrops({ email: "shopper@example.com", source: "footer" })).toBe("unavailable")
    expect(store.subscribe).not.toHaveBeenCalled()
    expect(runSignupConfirmations).not.toHaveBeenCalled()
  })
  it("acknowledges the durable request before running provider work", async () => {
    store.subscribe.mockResolvedValue("request-id")
    expect(await subscribeToDrops({ email: "shopper@example.com", source: "footer" })).toBe("saved")
    expect(runSignupConfirmations).not.toHaveBeenCalled()
    await after.mock.calls[0]![0]()
    expect(runSignupConfirmations).toHaveBeenCalledWith("request-id")
  })
  it.each(["reported", "thrown"])("keeps the accepted response for a %s deferred provider failure", async (failure) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    store.subscribe.mockResolvedValue("request-id")
    if (failure === "reported") runSignupConfirmations.mockResolvedValue({ sent: 0, errors: 1 })
    else runSignupConfirmations.mockRejectedValue(new Error("private provider body shopper@example.com"))
    expect(await subscribeToDrops({ email: "shopper@example.com", source: "footer" })).toBe("saved")
    await after.mock.calls[0]![0]()
    expect(warn.mock.calls).toEqual([["Signup confirmation deferred"]])
  })
  it("keeps the durable request accepted when a prompt run cannot be scheduled", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    store.subscribe.mockResolvedValue("request-id")
    after.mockImplementation(() => {
      throw new Error("scheduler unavailable")
    })
    expect(await subscribeToDrops({ email: "shopper@example.com", source: "footer" })).toBe("saved")
    expect(runSignupConfirmations).not.toHaveBeenCalled()
  })
  it("does not schedule provider work for eligible addresses or cooldowns", async () => {
    expect(await subscribeToDrops({ email: "shopper@example.com", source: "footer" })).toBe("saved")
    expect(after).not.toHaveBeenCalled()
  })
})

it.each(["busy", "rate-limited"])("returns %s without scheduling provider work", async (status) => {
  store.subscribe.mockResolvedValue(status)
  expect(await subscribeToDrops({ email: "shopper@example.com", source: "footer" })).toBe(status)
  expect(after).not.toHaveBeenCalled()
})

it("keeps successful prompt delivery quiet even when the store has been saturated", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  store.subscribe.mockResolvedValue("request-id")
  runSignupConfirmations.mockResolvedValue({ sent: 1, errors: 0, busy: false, saturated: true })
  expect(await subscribeToDrops({ email: "shopper@example.com", source: "footer" })).toBe("saved")
  await after.mock.calls[0]![0]()
  expect(warn).not.toHaveBeenCalled()
})
