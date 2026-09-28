import { beforeEach, describe, expect, it, vi } from "vitest"

import { storeConfig } from "@/lib/store-config"
import { readProductWeek } from "@/features/design-of-the-week/read-product-week.server"

import { listStorefrontProductIds } from "./list-storefront-product-ids.server"
import { readStorefrontProduct } from "./read-storefront-product.server"

import { getCatalog } from "./get-catalog.server"
import { normalizeCatalogProduct } from "./normalize-catalog-product"
import { readPopularity } from "./read-popularity.server"
import { readPublishedCatalog } from "./read-published-catalog.server"
const selectedProductIds = ["fixture-product"] as const

vi.mock("server-only", () => ({}))
const { testEnv } = vi.hoisted(() => ({
  testEnv: { PRINTIFY_API_TOKEN: "private-token", PRINTIFY_SHOP_ID: "123", PRINTIFY_PUBLISHING_ENABLED: false },
}))
vi.mock("@/lib/env", () => ({ env: testEnv }))
vi.mock("./list-storefront-product-ids.server", () => ({ listStorefrontProductIds: vi.fn() }))
vi.mock("./read-storefront-product.server", () => ({ readStorefrontProduct: vi.fn() }))
vi.mock("./read-published-catalog.server", () => ({ readPublishedCatalog: vi.fn() }))
vi.mock("./read-popularity.server", () => ({ readPopularity: vi.fn() }))
vi.mock("@/features/design-of-the-week/read-product-week.server", () => ({ readProductWeek: vi.fn() }))

beforeEach(() => {
  storeConfig.features.designOfTheWeek = true
  vi.clearAllMocks()
  testEnv.PRINTIFY_PUBLISHING_ENABLED = true
  vi.mocked(readPopularity).mockResolvedValue({ status: "ready", counts: {} })
  vi.mocked(readProductWeek).mockResolvedValue(null)
})

describe("getCatalog", () => {
  it("uses only published database membership, including products beyond sample IDs", async () => {
    const snapshots = [{ id: "new-product" }, { id: selectedProductIds[0] }]
    vi.mocked(listStorefrontProductIds).mockResolvedValue(snapshots.map((snapshot) => snapshot.id))
    vi.mocked(readStorefrontProduct).mockImplementation(
      async (id) => snapshots.find((snapshot) => snapshot.id === id) ?? null
    )
    vi.mocked(readPublishedCatalog).mockResolvedValue({ status: "ready", products: [] })
    await getCatalog()
    expect(readPublishedCatalog).toHaveBeenCalledExactlyOnceWith(snapshots)
    expect(readPopularity).toHaveBeenCalledExactlyOnceWith(["new-product", selectedProductIds[0]])
  })

  it("selects explicitly scheduled visible products and excludes hidden products", async () => {
    const snapshots = [
      { id: "drop-tee", storefront_artwork: { revisionId: "revision-a" } },
      { id: "other-design", storefront_artwork: { revisionId: "revision-z" } },
      { id: "unpublished-tee" },
    ]
    vi.mocked(listStorefrontProductIds).mockResolvedValue(snapshots.map((snapshot) => snapshot.id))
    vi.mocked(readStorefrontProduct).mockImplementation(
      async (id) => snapshots.find((snapshot) => snapshot.id === id) ?? null
    )
    vi.mocked(readPublishedCatalog).mockResolvedValue({ status: "ready", products: [] })
    vi.mocked(readProductWeek).mockResolvedValue({ productIds: ["drop-tee", "hidden-tee"] } as Awaited<
      ReturnType<typeof readProductWeek>
    >)
    const catalog = await getCatalog()
    expect(catalog.designOfTheWeekProductIds).toEqual(["drop-tee"])
    expect(JSON.stringify(catalog)).not.toContain("revision-a")
  })

  // Use the caller's resolved week when one is supplied.
  it("resolves membership against the drop the caller already read, without reading it again", async () => {
    const snapshots = [
      { id: "callers-tee", storefront_artwork: { revisionId: "revision-caller" } },
      { id: "other-tee", storefront_artwork: { revisionId: "revision-other" } },
    ]
    vi.mocked(listStorefrontProductIds).mockResolvedValue(snapshots.map((snapshot) => snapshot.id))
    vi.mocked(readStorefrontProduct).mockImplementation(
      async (id) => snapshots.find((snapshot) => snapshot.id === id) ?? null
    )
    vi.mocked(readPublishedCatalog).mockResolvedValue({ status: "ready", products: [] })
    // What its own read would have returned, so a reintroduced read would look like success.
    vi.mocked(readProductWeek).mockResolvedValue({ productIds: ["other-tee"] } as Awaited<
      ReturnType<typeof readProductWeek>
    >)
    const callersDrop = { productIds: ["callers-tee"] } as Awaited<ReturnType<typeof readProductWeek>>

    expect((await getCatalog({ productWeek: callersDrop })).designOfTheWeekProductIds).toEqual(["callers-tee"])
    expect(readProductWeek).not.toHaveBeenCalled()
  })

  // A promise, so the page can start both from one read and give up no parallelism for the coherence.
  it("accepts the caller's read as a promise", async () => {
    vi.mocked(listStorefrontProductIds).mockResolvedValue(["callers-tee"])
    vi.mocked(readStorefrontProduct).mockResolvedValue({
      id: "callers-tee",
      storefront_artwork: { revisionId: "revision-caller" },
    } as Awaited<ReturnType<typeof readStorefrontProduct>>)
    vi.mocked(readPublishedCatalog).mockResolvedValue({ status: "ready", products: [] })
    const reading = Promise.resolve({ productIds: ["callers-tee"] } as Awaited<ReturnType<typeof readProductWeek>>)

    expect((await getCatalog({ productWeek: reading })).designOfTheWeekProductIds).toEqual(["callers-tee"])
    expect(readProductWeek).not.toHaveBeenCalled()
  })

  // An explicit null is the caller saying "I read it and there is no drop", not "read it for me".
  it("takes an explicit null from the caller as no drop", async () => {
    vi.mocked(listStorefrontProductIds).mockResolvedValue([])
    vi.mocked(readPublishedCatalog).mockResolvedValue({ status: "empty", products: [] })
    vi.mocked(readProductWeek).mockResolvedValue({ productIds: ["other-tee"] } as Awaited<
      ReturnType<typeof readProductWeek>
    >)

    expect(await getCatalog({ productWeek: null })).not.toHaveProperty("designOfTheWeekProductIds")
    expect(readProductWeek).not.toHaveBeenCalled()
  })

  // Absent, not empty: the page tells "no drop resolved here" from "a drop with no tees yet".
  it("leaves the drop's ids off entirely when no drop is live", async () => {
    vi.mocked(listStorefrontProductIds).mockResolvedValue([])
    vi.mocked(readPublishedCatalog).mockResolvedValue({ status: "empty", products: [] })
    expect(await getCatalog()).not.toHaveProperty("designOfTheWeekProductIds")
  })

  // Decided here against one clock reading, so the cards never read a clock while they render.
  it("lists exactly the products that arrived in the shop less than two weeks ago", async () => {
    const now = Date.parse("2026-09-20T12:00:00.000Z")
    const day = 24 * 60 * 60 * 1000
    const arrivals: Record<string, string | null> = {
      "fresh-tee": new Date(now - 3 * day).toISOString(),
      "last-day-tee": new Date(now - 14 * day + 1).toISOString(),
      "two-week-tee": new Date(now - 14 * day).toISOString(),
      "old-tee": new Date(now - 40 * day).toISOString(),
      "undated-tee": null,
    }
    const products = Object.entries(arrivals).map(([id, storefront_added_to_shop_at]) =>
      normalizeCatalogProduct({
        id,
        shop_id: 123,
        title: id,
        variants: [],
        options: [],
        images: [],
        storefront_added_to_shop_at,
      })
    )
    vi.mocked(listStorefrontProductIds).mockResolvedValue(Object.keys(arrivals))
    vi.mocked(readStorefrontProduct).mockImplementation(async (id) => ({ id }))
    vi.mocked(readPublishedCatalog).mockResolvedValue({ status: "ready", products })

    vi.setSystemTime(now)
    try {
      const catalog = await getCatalog()
      expect(catalog.newProductIds).toEqual(["fresh-tee", "last-day-tee"])
      expect(catalog.products.map((product) => product.id)).toEqual(Object.keys(arrivals))
    } finally {
      vi.useRealTimers()
    }
  })

  it("lists no new products for an empty shop", async () => {
    vi.mocked(listStorefrontProductIds).mockResolvedValue([])
    vi.mocked(readPublishedCatalog).mockResolvedValue({ status: "empty", products: [] })
    expect((await getCatalog()).newProductIds).toEqual([])
  })

  it("does not fall back to live drafts when the published catalog is empty", async () => {
    vi.mocked(listStorefrontProductIds).mockResolvedValue([])
    vi.mocked(readPublishedCatalog).mockResolvedValue({ status: "empty", products: [] })
    expect(await getCatalog()).toMatchObject({ status: "empty", products: [] })
    expect(readPopularity).toHaveBeenCalledExactlyOnceWith([])
  })

  it("reports storage failure without publishing unapproved provider drafts", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    vi.mocked(listStorefrontProductIds).mockRejectedValue(new Error("database unavailable"))
    expect(await getCatalog()).toEqual({ status: "unavailable", products: [], popularityStatus: "unavailable" })
    expect(readPublishedCatalog).not.toHaveBeenCalled()
    expect(readPopularity).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it("reports unavailable if all cached members fail to load without exposing live drafts", async () => {
    vi.mocked(listStorefrontProductIds).mockResolvedValue(["published-product"])
    vi.mocked(readStorefrontProduct).mockRejectedValue(new Error("database unavailable"))
    vi.mocked(readPublishedCatalog).mockResolvedValue({ status: "empty", products: [] })
    expect(await getCatalog()).toMatchObject({ status: "unavailable", products: [] })
  })

  it("requires publishing and does not read any data while disabled", async () => {
    testEnv.PRINTIFY_PUBLISHING_ENABLED = false
    expect(await getCatalog()).toEqual({ status: "unavailable", products: [], popularityStatus: "unavailable" })
    expect(listStorefrontProductIds).not.toHaveBeenCalled()
    expect(readPublishedCatalog).not.toHaveBeenCalled()
    expect(readPopularity).not.toHaveBeenCalled()
  })
})

it("keeps the catalog available without reading or using a disabled weekly schedule", async () => {
  storeConfig.features.designOfTheWeek = false
  vi.mocked(listStorefrontProductIds).mockResolvedValue(["tee-a"])
  vi.mocked(readStorefrontProduct).mockResolvedValue({ id: "tee-a" })
  vi.mocked(readPublishedCatalog).mockResolvedValue({ status: "ready", products: [] })
  const catalog = await getCatalog({ productWeek: { liveAt: "2026-09-21T09:00:00.000Z", productIds: ["tee-a"] } })
  expect(catalog.status).toBe("ready")
  expect(catalog).not.toHaveProperty("designOfTheWeekProductIds")
  await getCatalog()
  expect(readProductWeek).not.toHaveBeenCalled()
})
