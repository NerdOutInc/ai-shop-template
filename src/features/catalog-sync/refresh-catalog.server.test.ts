import { revalidateTag } from "next/cache"
import { beforeEach, expect, it, vi } from "vitest"
import { getPublishingStore } from "@/features/publishing/get-publishing-store.server"
import { fetchCatalogPopularity } from "./fetch-catalog-popularity.server"
import { fetchCatalogStock } from "./fetch-catalog-stock.server"
import { getCatalogSyncStore } from "./get-catalog-sync-store.server"
import { refreshCatalog } from "./refresh-catalog.server"
vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }))
vi.mock("@/features/publishing/get-publishing-store.server", () => ({ getPublishingStore: vi.fn() }))
vi.mock("./fetch-catalog-popularity.server", () => ({ fetchCatalogPopularity: vi.fn() }))
vi.mock("./fetch-catalog-stock.server", () => ({ fetchCatalogStock: vi.fn() }))
vi.mock("./get-catalog-sync-store.server", () => ({ getCatalogSyncStore: vi.fn() }))
const config = vi.hoisted(() => ({
  PRINTIFY_PUBLISHING_ENABLED: true,
  PRINTIFY_API_TOKEN: "token",
  PRINTIFY_SHOP_ID: "123",
}))
vi.mock("@/lib/env", () => ({ env: config }))
const listProductIds = vi.fn()
const refresh = vi.fn()
beforeEach(() => {
  Object.assign(config, { PRINTIFY_PUBLISHING_ENABLED: true, PRINTIFY_API_TOKEN: "token", PRINTIFY_SHOP_ID: "123" })
  vi.mocked(getPublishingStore).mockReturnValue({ listProductIds } as unknown as ReturnType<typeof getPublishingStore>)
  vi.mocked(getCatalogSyncStore).mockReturnValue({ refresh } as unknown as ReturnType<typeof getCatalogSyncStore>)
  listProductIds.mockResolvedValue(["published-a", "published-b"])
  refresh.mockImplementation(async (_kind, fetchPayload) => {
    await fetchPayload()
    return "updated"
  })
})
it("uses uncached published membership for one bulk stock scan", async () => {
  expect(await refreshCatalog("stock")).toBe("updated")
  expect(fetchCatalogStock).toHaveBeenCalledExactlyOnceWith({ apiToken: "token", shopId: "123" }, [
    "published-a",
    "published-b",
  ])
  expect(fetchCatalogPopularity).not.toHaveBeenCalled()
})
it("refreshes popularity independently", async () => {
  await refreshCatalog("popularity")
  expect(fetchCatalogPopularity).toHaveBeenCalledExactlyOnceWith("token", "123", ["published-a", "published-b"])
  expect(fetchCatalogStock).not.toHaveBeenCalled()
})
it("does not fetch or query membership when another worker owns the job", async () => {
  refresh.mockResolvedValue("busy")
  expect(await refreshCatalog("stock")).toBe("busy")
  expect(listProductIds).not.toHaveBeenCalled()
  expect(fetchCatalogStock).not.toHaveBeenCalled()
})
it("does not turn a membership outage into an empty aggregate", async () => {
  listProductIds.mockRejectedValue(new Error("database offline"))
  await expect(refreshCatalog("stock")).rejects.toThrow()
  expect(fetchCatalogStock).not.toHaveBeenCalled()
})
it.each(["disabled", "token", "shop"])("rejects %s before accessing storage or providers", async (fault) => {
  if (fault === "disabled") config.PRINTIFY_PUBLISHING_ENABLED = false
  if (fault === "token") config.PRINTIFY_API_TOKEN = "private\r\ntoken"
  if (fault === "shop") config.PRINTIFY_SHOP_ID = "../other"
  await expect(refreshCatalog("stock")).rejects.toThrow("CATALOG_REFRESH_NOT_CONFIGURED")
  expect(getCatalogSyncStore).not.toHaveBeenCalled()
  expect(listProductIds).not.toHaveBeenCalled()
})

it("invalidates only after a complete commit and retries missed invalidation for recent observations", async () => {
  for (const result of ["updated", "recent"]) {
    vi.mocked(revalidateTag).mockClear()
    refresh.mockResolvedValue(result)
    await refreshCatalog("stock")
    expect(revalidateTag).toHaveBeenCalledExactlyOnceWith("catalog-observation-stock", { expire: 0 })
  }
})
it("keeps cached observations when refresh fails or another worker is busy", async () => {
  refresh.mockResolvedValue("busy")
  await refreshCatalog("stock")
  expect(revalidateTag).not.toHaveBeenCalled()
  refresh.mockRejectedValue(new Error("incomplete scan"))
  await expect(refreshCatalog("stock")).rejects.toThrow("incomplete scan")
  expect(revalidateTag).not.toHaveBeenCalled()
})

it("passes authenticated force intent to the locked store", async () => {
  await refreshCatalog("stock", { force: true })
  expect(refresh).toHaveBeenCalledExactlyOnceWith("stock", expect.any(Function), { force: true })
})
