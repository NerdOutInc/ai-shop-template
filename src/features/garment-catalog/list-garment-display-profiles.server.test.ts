// @vitest-environment node
import { unstable_cache } from "next/cache"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { refreshStorefront } from "@/features/design-of-the-week/refresh-storefront.server"

import type { GarmentDisplayProfile } from "./garment-catalog"
import { listGarmentDisplayProfiles } from "./list-garment-display-profiles.server"

const { getPublishingStore, listDisplayProfiles, cacheEntries, env } = vi.hoisted(() => ({
  getPublishingStore: vi.fn(),
  listDisplayProfiles: vi.fn(),
  cacheEntries: new Map<string, { serialized: string; tags: string[] }>(),
  env: { DATABASE_URL: "postgresql://store:private-password@localhost/store", PRINTIFY_SHOP_ID: "123" },
}))
vi.mock("server-only", () => ({}))
vi.mock("@/features/publishing/get-publishing-store.server", () => ({ getPublishingStore }))
vi.mock("@/lib/env", () => ({ env }))
vi.mock("next/cache", () => ({
  unstable_cache: vi.fn((callback: () => Promise<unknown>, keys: string[], options: { tags: string[] }) => async () => {
    const key = JSON.stringify(keys)
    const cached = cacheEntries.get(key)
    if (cached) return JSON.parse(cached.serialized)
    const serialized = JSON.stringify(await callback())
    cacheEntries.set(key, { serialized, tags: options.tags })
    return JSON.parse(serialized)
  }),
  revalidateTag: vi.fn((tag: string) => {
    for (const [key, entry] of cacheEntries) if (entry.tags.includes(tag)) cacheEntries.delete(key)
  }),
  revalidatePath: vi.fn(),
}))

const cropTop: GarmentDisplayProfile = {
  manufacturer: "Next Level",
  model: "5080",
  categoryName: "Crop tops",
  categorySortPosition: 3,
  categorySlug: "crop-tops",
  gender: "female",
}

beforeEach(() => {
  vi.clearAllMocks()
  cacheEntries.clear()
  env.DATABASE_URL = "postgresql://store:private-password@localhost/store"
  env.PRINTIFY_SHOP_ID = "123"
  vi.spyOn(console, "warn").mockImplementation(() => {})
  getPublishingStore.mockReturnValue({ garments: { listDisplayProfiles } })
  listDisplayProfiles.mockResolvedValue(new Map([[1312, cropTop]]))
})

describe("listGarmentDisplayProfiles", () => {
  it("caches JSON-safe entries for five minutes and reconstructs the saved profiles without another query", async () => {
    expect((await listGarmentDisplayProfiles())?.get(1312)).toEqual(cropTop)
    expect((await listGarmentDisplayProfiles())?.get(1312)).toEqual(cropTop)
    expect(listDisplayProfiles).toHaveBeenCalledTimes(1)
    expect(JSON.parse([...cacheEntries.values()][0]!.serialized)).toEqual([[1312, cropTop]])
    expect(vi.mocked(unstable_cache).mock.calls[0]?.[1]).toEqual([
      "garment-display-profiles-v2",
      "123",
      expect.stringMatching(/^[a-f0-9]{64}$/),
    ])
    expect(vi.mocked(unstable_cache).mock.calls[0]?.[2]).toEqual({
      revalidate: 300,
      tags: ["printify-published-catalog"],
    })
    expect(JSON.stringify(vi.mocked(unstable_cache).mock.calls.map((call) => call.slice(1)))).not.toContain(
      "private-password"
    )
  })

  it("reads updated labels and category order after a storefront refresh invalidates their shared tag", async () => {
    expect((await listGarmentDisplayProfiles())?.get(1312)).toEqual(cropTop)
    listDisplayProfiles.mockResolvedValue(
      new Map([[1312, { ...cropTop, model: "Updated", categoryName: "Crops", categorySortPosition: 1 }]])
    )
    expect((await listGarmentDisplayProfiles())?.get(1312)).toEqual(cropTop)
    refreshStorefront()
    expect((await listGarmentDisplayProfiles())?.get(1312)).toEqual({
      ...cropTop,
      model: "Updated",
      categoryName: "Crops",
      categorySortPosition: 1,
    })
    expect(listDisplayProfiles).toHaveBeenCalledTimes(2)
  })

  it("isolates cached profiles by shop and database", async () => {
    await listGarmentDisplayProfiles()
    env.PRINTIFY_SHOP_ID = "456"
    listDisplayProfiles.mockResolvedValue(new Map())
    expect(await listGarmentDisplayProfiles()).toEqual(new Map())
    env.DATABASE_URL = "postgresql://store:another-password@localhost/another-store"
    await listGarmentDisplayProfiles()
    expect(listDisplayProfiles).toHaveBeenCalledTimes(3)
    expect(cacheEntries.size).toBe(3)
    expect([...cacheEntries.keys()].join()).not.toMatch(/password|postgresql/)
  })

  it("caches an empty saved catalog as a successful answer", async () => {
    listDisplayProfiles.mockResolvedValue(new Map())
    expect(await listGarmentDisplayProfiles()).toEqual(new Map())
    expect(await listGarmentDisplayProfiles()).toEqual(new Map())
    expect(listDisplayProfiles).toHaveBeenCalledTimes(1)
    expect(console.warn).not.toHaveBeenCalled()
  })

  it("does not cache a failed first read or expose database details, and retries on the next request", async () => {
    listDisplayProfiles.mockRejectedValueOnce(new Error("private database password"))
    expect(await listGarmentDisplayProfiles()).toBeNull()
    expect(cacheEntries.size).toBe(0)
    expect(console.warn).toHaveBeenCalledExactlyOnceWith("Product garment profiles unavailable", {
      reason: "storage",
    })
    expect((await listGarmentDisplayProfiles())?.get(1312)).toEqual(cropTop)
    expect(listDisplayProfiles).toHaveBeenCalledTimes(2)
  })

  it("rejects a failed refresh so the data cache can retain the previous successful labels", async () => {
    await listGarmentDisplayProfiles()
    const fill = vi.mocked(unstable_cache).mock.calls[0]![0]
    listDisplayProfiles.mockRejectedValue(new Error("private database password"))
    // Exercise the fill boundary Next calls during revalidation: returning null here would replace good labels.
    await expect(fill()).rejects.toThrow("Product garment profiles unavailable")
    expect((await listGarmentDisplayProfiles())?.get(1312)).toEqual(cropTop)
    expect(console.warn).not.toHaveBeenCalled()
  })

  it.each(["DATABASE_URL", "PRINTIFY_SHOP_ID"] as const)("returns no profile without %s", async (key) => {
    env[key] = ""
    expect(await listGarmentDisplayProfiles()).toBeNull()
    expect(listDisplayProfiles).not.toHaveBeenCalled()
    expect(unstable_cache).not.toHaveBeenCalled()
  })

  it("returns no profile when publishing storage cannot be opened", async () => {
    getPublishingStore.mockImplementation(() => {
      throw new Error("not configured")
    })
    expect(await listGarmentDisplayProfiles()).toBeNull()
    expect(listDisplayProfiles).not.toHaveBeenCalled()
    expect(cacheEntries.size).toBe(0)
  })
})
