import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { track } = vi.hoisted(() => ({ track: vi.fn(() => true) }))
vi.mock("./track-store-event", () => ({ trackStoreEvent: track }))
const receipt = "a".repeat(64)
const purchase = { receipt, totalUsd: 32.95 }
const key = "your-store-purchase-attempts-v1"

describe("purchase conversion attempts", () => {
  afterEach(() => vi.unstubAllGlobals())
  beforeEach(() => {
    vi.resetModules()
    track.mockReset().mockReturnValue(true)
    localStorage.clear()
  })

  it("deduplicates concurrent polling and a later page reload without sending a receipt identifier", async () => {
    const { trackPurchaseConversion } = await import("./track-purchase-conversion")
    await Promise.all([trackPurchaseConversion(purchase), trackPurchaseConversion(purchase)])
    vi.resetModules()
    await (await import("./track-purchase-conversion")).trackPurchaseConversion(purchase)
    expect(track).toHaveBeenCalledExactlyOnceWith({ name: "purchase", totalUsd: 32.95 })
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual([{ receipt, at: expect.any(Number) }])
  })

  it("allows a second purchase while suppressing repeats of the first", async () => {
    const { trackPurchaseConversion } = await import("./track-purchase-conversion")
    await trackPurchaseConversion(purchase)
    await trackPurchaseConversion({ receipt: "b".repeat(64), totalUsd: 60 })
    await trackPurchaseConversion(purchase)
    expect(track).toHaveBeenCalledTimes(2)
  })

  it("does not persist a marker when the SDK could not be invoked", async () => {
    track.mockReturnValueOnce(false)
    const { trackPurchaseConversion } = await import("./track-purchase-conversion")
    await trackPurchaseConversion(purchase)
    expect(localStorage.getItem(key)).toBeNull()
    await trackPurchaseConversion(purchase)
    expect(track).toHaveBeenCalledTimes(2)
    expect(localStorage.getItem(key)).not.toBeNull()
  })

  it("uses memory when storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Blocked")
    })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Blocked")
    })
    const { trackPurchaseConversion } = await import("./track-purchase-conversion")
    await trackPurchaseConversion(purchase)
    await trackPurchaseConversion(purchase)
    expect(track).toHaveBeenCalledOnce()
  })

  it.each([
    undefined,
    null,
    {},
    { ...purchase, receipt: "cs_live_private" },
    { ...purchase, totalUsd: -1 },
    { ...purchase, totalUsd: NaN },
  ])("ignores absent or invalid server summaries", async (invalid) => {
    await (await import("./track-purchase-conversion")).trackPurchaseConversion(invalid)
    expect(track).not.toHaveBeenCalled()
  })

  it("uses the browser lock to serialize receipt checks across tabs", async () => {
    const request = vi.fn(async (_name: string, callback: () => void) => callback())
    vi.stubGlobal("navigator", { locks: { request } })
    await (await import("./track-purchase-conversion")).trackPurchaseConversion(purchase)
    expect(request).toHaveBeenCalledWith(key, expect.any(Function))
    expect(track).toHaveBeenCalledOnce()
  })

  it("bounds stored attempts and discards expired receipts", async () => {
    const entries = Array.from({ length: 120 }, (_, index) => ({
      receipt: index.toString(16).padStart(64, "0"),
      at: Date.now(),
    }))
    localStorage.setItem(key, JSON.stringify([...entries, { receipt, at: 0 }]))
    await (await import("./track-purchase-conversion")).trackPurchaseConversion(purchase)
    expect(JSON.parse(localStorage.getItem(key)!)).toHaveLength(100)
    expect(track).toHaveBeenCalledOnce()
  })

  it("does not evict the oldest retained receipt before checking a duplicate at capacity", async () => {
    const entries = Array.from({ length: 99 }, (_, index) => ({
      receipt: index.toString(16).padStart(64, "0"),
      at: Date.now(),
    }))
    localStorage.setItem(key, JSON.stringify([{ receipt, at: Date.now() }, ...entries]))
    await (await import("./track-purchase-conversion")).trackPurchaseConversion(purchase)
    expect(track).not.toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem(key)!)).toHaveLength(100)
  })
})
