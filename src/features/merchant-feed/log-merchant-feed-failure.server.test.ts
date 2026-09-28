import { afterEach, describe, expect, it, vi } from "vitest"

import { logMerchantFeedFailure } from "./log-merchant-feed-failure.server"
import { MerchantFeedError } from "./merchant-feed-error"

vi.mock("server-only", () => ({}))
afterEach(() => vi.restoreAllMocks())

describe("Merchant feed failure diagnostics", () => {
  it("records fixed reason codes and safe product identifiers without error payloads", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
    logMerchantFeedFailure(new MerchantFeedError("INVALID_DESCRIPTION", "shirt-a"), "publishing-health")
    logMerchantFeedFailure(new MerchantFeedError("SNAPSHOT_DISPLAY_INVALID", "private\nprovider-token"), "route")
    logMerchantFeedFailure(new Error("postgres://user:private-password@host/database"), "route")
    expect(log.mock.calls).toEqual([
      ["Merchant feed unavailable", { source: "publishing-health", code: "INVALID_DESCRIPTION", productId: "shirt-a" }],
      ["Merchant feed unavailable", { source: "route", code: "SNAPSHOT_DISPLAY_INVALID" }],
      ["Merchant feed unavailable", { source: "route", code: "UNKNOWN_ERROR" }],
    ])
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|postgres/)
  })
})
