// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { readProductWeek } from "./read-product-week.server"

const { cache, list, testEnv } = vi.hoisted(() => ({
  cache: new Map<string, unknown>(),
  list: vi.fn(),
  testEnv: { DATABASE_URL: "postgresql://localhost/store", PRINTIFY_SHOP_ID: "123", PRINTIFY_PUBLISHING_ENABLED: true },
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/env", () => ({ env: testEnv }))
vi.mock("@/features/publishing/get-publishing-store.server", () => ({
  getPublishingStore: () => ({ productSchedule: { list } }),
}))
vi.mock("next/cache", () => ({
  unstable_cache: vi.fn((callback: () => Promise<unknown>, keys: string[]) => async () => {
    const key = JSON.stringify(keys)
    if (cache.has(key)) return cache.get(key)
    const result = await callback()
    cache.set(key, result)
    return result
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  cache.clear()
  testEnv.PRINTIFY_PUBLISHING_ENABLED = true
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-10-26T08:59:59Z"))
})
afterEach(() => vi.useRealTimers())

describe("readProductWeek", () => {
  it("reveals and expires cached membership without a write or a database reread", async () => {
    list.mockResolvedValue([
      { id: "a", productId: "tee-a", liveAt: "2026-10-26T09:00:00.000Z" },
      { id: "b", productId: "tee-b", liveAt: "2026-10-26T09:00:00.000Z" },
    ])
    expect(await readProductWeek()).toBeNull()
    vi.setSystemTime(new Date("2026-10-26T09:00:00Z"))
    expect(await readProductWeek()).toEqual({ liveAt: "2026-10-26T09:00:00.000Z", productIds: ["tee-a", "tee-b"] })
    vi.setSystemTime(new Date("2026-11-02T10:00:00Z"))
    expect(await readProductWeek()).toBeNull()
    expect(list).toHaveBeenCalledTimes(1)
  })

  it("does not cache failures or leak database details", async () => {
    list.mockRejectedValueOnce(new Error("private database host"))
    expect(await readProductWeek()).toBeNull()
    list.mockResolvedValue([{ id: "a", productId: "tee-a", liveAt: "2026-10-19T09:00:00.000Z" }])
    expect((await readProductWeek())?.productIds).toEqual(["tee-a"])
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("private database host")
  })

  it("does not read storage while publishing is disabled", async () => {
    testEnv.PRINTIFY_PUBLISHING_ENABLED = false
    expect(await readProductWeek()).toBeNull()
    expect(list).not.toHaveBeenCalled()
  })
})
