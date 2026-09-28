import { revalidateTag, unstable_cache } from "next/cache"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { readPopularity } from "@/features/catalog/read-popularity.server"

import { getCatalogSyncStore } from "./get-catalog-sync-store.server"
import { readCatalogObservation } from "./read-catalog-observation.server"
import { readCatalogStock } from "./read-catalog-stock.server"

const { entries, config } = vi.hoisted(() => ({
  entries: new Map<string, { json: string; tags: string[] }>(),
  config: { DATABASE_URL: "postgresql://store:private-password@localhost/store", PRINTIFY_SHOP_ID: "123" },
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/env", () => ({ env: config }))
vi.mock("./get-catalog-sync-store.server", () => ({ getCatalogSyncStore: vi.fn() }))
vi.mock("next/cache", () => ({
  unstable_cache: vi.fn((read: () => Promise<unknown>, keys: string[], options: { tags: string[] }) => async () => {
    const key = JSON.stringify(keys)
    if (entries.has(key)) return JSON.parse(entries.get(key)!.json)
    const json = JSON.stringify(await read())
    entries.set(key, { json, tags: options.tags })
    return JSON.parse(json)
  }),
  revalidateTag: vi.fn((tag: string) => {
    for (const [key, entry] of entries) if (entry.tags.includes(tag)) entries.delete(key)
  }),
}))
const read = vi.fn()
const stock = {
  fingerprintVersion: "v2",
  products: { shirt: [{ id: 1, inStock: true, enabled: true, fingerprint: "v2:example" }] },
}
beforeEach(() => {
  entries.clear()
  Object.assign(config, {
    DATABASE_URL: "postgresql://store:private-password@localhost/store",
    PRINTIFY_SHOP_ID: "123",
  })
  vi.mocked(getCatalogSyncStore).mockReturnValue({ read } as unknown as ReturnType<typeof getCatalogSyncStore>)
  read.mockImplementation(async (kind) => ({
    payload: kind === "stock" ? stock : { shirt: 7 },
    observed_at: new Date(),
  }))
})
afterEach(() => vi.useRealTimers())

it("reuses JSON-serialized observations across requests without querying Postgres again", async () => {
  const first = await readCatalogObservation("stock")
  expect(typeof first?.observedAt).toBe("number")
  expect(await readCatalogObservation("stock")).toEqual(first)
  expect(await readCatalogStock()).toEqual(stock.products)
  expect(read).toHaveBeenCalledExactlyOnceWith("stock")
  expect(await readPopularity(["shirt"])).toEqual({ status: "ready", counts: { shirt: 7 } })
  await readPopularity(["shirt"])
  expect(read).toHaveBeenCalledTimes(2)
})
it("refreshes the affected observation after invalidation without discarding the other kind", async () => {
  await readCatalogObservation("stock")
  await readCatalogObservation("popularity")
  read.mockResolvedValue({ payload: { replacement: true }, observed_at: new Date() })
  revalidateTag("catalog-observation-stock", { expire: 0 })
  expect((await readCatalogObservation("stock"))?.payload).toEqual({ replacement: true })
  expect((await readCatalogObservation("popularity"))?.payload).toEqual({ shirt: 7 })
  expect(read).toHaveBeenCalledTimes(3)
})
it("keeps freshness checks outside the cache even when stale values survive failed revalidation", async () => {
  vi.useFakeTimers({ toFake: ["Date"] })
  const now = Date.now()
  expect(await readCatalogStock()).toEqual(stock.products)
  expect(await readPopularity(["shirt"])).toMatchObject({ status: "ready" })
  vi.setSystemTime(now + 2 * 60 * 60_000 - 1)
  expect(await readCatalogStock()).toEqual(stock.products)
  vi.setSystemTime(now + 2 * 60 * 60_000)
  expect(await readCatalogStock()).toBeNull()
  expect(await readPopularity(["shirt"])).toMatchObject({ status: "ready" })
  vi.setSystemTime(now + 24 * 60 * 60_000 - 1)
  expect(await readPopularity(["shirt"])).toMatchObject({ status: "ready" })
  vi.setSystemTime(now + 24 * 60 * 60_000)
  expect(await readPopularity(["shirt"])).toEqual({ status: "unavailable" })
  expect(read).toHaveBeenCalledTimes(2)
})
it("isolates shops and databases without putting credentials in cache keys", async () => {
  await readCatalogObservation("stock")
  config.PRINTIFY_SHOP_ID = "456"
  await readCatalogObservation("stock")
  config.DATABASE_URL = "postgresql://store:other-private-password@localhost/other"
  await readCatalogObservation("stock")
  expect(read).toHaveBeenCalledTimes(3)
  expect(JSON.stringify(vi.mocked(unstable_cache).mock.calls)).not.toContain("private-password")
})
it("rejects failed cache fills without retaining an empty value or a private database error", async () => {
  read.mockRejectedValueOnce(new Error("private database password"))
  await expect(readCatalogObservation("stock")).rejects.toThrow("Catalog observation unavailable")
  expect((await readCatalogObservation("stock"))?.payload).toEqual(stock)
  expect(read).toHaveBeenCalledTimes(2)
})
