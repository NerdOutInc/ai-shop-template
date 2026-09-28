// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { readCatalogRefreshHealth } from "@/features/catalog-sync/read-catalog-refresh-health.server"

import { getPublishingStore } from "./get-publishing-store.server"
import { mergePublishedProduct } from "./merge-published-product"
import { readPublishingHealth } from "./read-publishing-health.server"

const config = vi.hoisted(() => ({
  NEXT_PUBLIC_SITE_URL: "https://example.com",
  PRINTIFY_PUBLISHING_ENABLED: true,
  PRINTIFY_API_TOKEN: "fixture-read-token",
  PRINTIFY_SHOP_ID: "123",
  DATABASE_URL: "postgresql://localhost/fixture",
  PRINTIFY_PUBLISHING_API_TOKEN: "fixture-write-token",
  PRINTIFY_WEBHOOK_SECRET: "fixture-webhook-secret",
  CRON_SECRET: "fixture-cron-secret",
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/env", () => ({ env: config }))
vi.mock("./get-publishing-store.server", () => ({ getPublishingStore: vi.fn() }))

vi.mock("@/features/catalog-sync/read-catalog-refresh-health.server", () => ({ readCatalogRefreshHealth: vi.fn() }))

const readHealth = vi.fn()
const listProducts = vi.fn()
const listFeedProfiles = vi.fn()
const productFetch = vi.fn<typeof fetch>()
const inventoryFetch = vi.fn<typeof fetch>()
const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.mocked(readCatalogRefreshHealth).mockResolvedValue([])
  config.PRINTIFY_PUBLISHING_ENABLED = true
  config.PRINTIFY_API_TOKEN = "fixture-read-token"
  readHealth.mockResolvedValue({
    openJobProductIds: [],
    openJobProductCount: 0,
    activeProducts: 2,
    attentionJobs: 0,
    overdueJobs: 0,
    productIds: ["shirt-a", "shirt-b"],
  })
  listProducts.mockResolvedValue([publishedFixture("shirt-a"), publishedFixture("shirt-b")])
  listFeedProfiles.mockResolvedValue(
    new Map([[1317, { googleProductCategory: 212, ageGroup: "adult", gender: "unisex", sizeSystem: "US" }]])
  )
  vi.mocked(getPublishingStore).mockReturnValue({ readHealth, listProducts, garments: { listFeedProfiles } } as never)
  vi.spyOn(console, "error").mockImplementation(() => undefined)
  productFetch.mockImplementation(async (input) => {
    const productId = new URL(String(input)).pathname
      .split("/")
      .at(-1)!
      .replace(/\.json$/, "")
    return Response.json(productFixture(productId))
  })
  inventoryFetch.mockImplementation(async () =>
    Response.json({
      current_page: 1,
      last_page: 1,
      total: 2,
      data: ["shirt-a", "shirt-b"].map((id) => ({ id, shop_id: 123, is_locked: false })),
    })
  )
  fetchMock.mockImplementation((input, options) =>
    new URL(String(input)).pathname.endsWith("/products.json")
      ? inventoryFetch(input, options)
      : productFetch(input, options)
  )
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe("read-only publishing health", () => {
  it("validates hidden crop tops, hoodies, and tanks with their configured garment profiles", async () => {
    const garments = [
      [1317, "unisex"],
      [1312, "female"],
      [2679, "female"],
      [3076, "male"],
    ] as const
    listProducts.mockResolvedValue(
      garments.map(([blueprint]) => ({ ...publishedFixture(`garment-${blueprint}`), blueprint_id: blueprint }))
    )
    listFeedProfiles.mockResolvedValue(
      new Map(
        garments.map(([blueprint, gender]) => [
          blueprint,
          { googleProductCategory: 212, ageGroup: "adult", gender, sizeSystem: "US" },
        ])
      )
    )
    expect(await readPublishingHealth()).toMatchObject({ status: "healthy", issues: [] })
    expect(listFeedProfiles).toHaveBeenCalledTimes(1)
    expect(console.error).not.toHaveBeenCalled()
  })

  it("does not infer a missing garment profile from the original T-shirt", async () => {
    listFeedProfiles.mockResolvedValue(new Map())
    expect(await readPublishingHealth()).toMatchObject({ status: "unhealthy", issues: ["MERCHANT_CATALOG_INVALID"] })
    expect(console.error).toHaveBeenCalledWith("Merchant feed unavailable", {
      source: "publishing-health",
      code: "UNSUPPORTED_BLUEPRINT",
      productId: "shirt-a",
    })
  })

  it("reports unavailable garment storage as a database failure", async () => {
    listFeedProfiles.mockRejectedValue(new Error("private database password"))
    expect(await readPublishingHealth()).toMatchObject({ status: "unhealthy", issues: ["DATABASE_UNAVAILABLE"] })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledExactlyOnceWith("Merchant feed unavailable", {
      source: "publishing-health",
      code: "DATABASE_UNAVAILABLE",
    })
  })

  it("alerts when a first publication omits description even though the saved provider description is valid", async () => {
    const live = publishedFixture("shirt-a")
    const snapshot = mergePublishedProduct(
      {
        id: "first-publication",
        productId: "shirt-a",
        shopId: "123",
        createdAt: "2026-09-11T00:00:00.000Z",
        action: "create",
        publishDetails: { title: true, images: true, variants: true, description: false },
      },
      live,
      null
    )
    expect(snapshot.description).toBe("")
    listProducts.mockResolvedValue([snapshot, publishedFixture("shirt-b")])
    productFetch.mockImplementation(async (input) =>
      Response.json(publishedFixture(String(input).includes("shirt-a.json") ? "shirt-a" : "shirt-b"))
    )
    expect(await readPublishingHealth()).toMatchObject({
      status: "unhealthy",
      issues: ["MERCHANT_CATALOG_INVALID"],
      counts: { checkedProducts: 2 },
    })
    expect(console.error).toHaveBeenCalledWith("Merchant feed unavailable", {
      source: "publishing-health",
      code: "INVALID_DESCRIPTION",
      productId: "shirt-a",
    })

    const repaired = mergePublishedProduct(
      {
        id: "repair-description",
        productId: "shirt-a",
        shopId: "123",
        createdAt: "2026-09-11T01:00:00.000Z",
        action: "update",
        publishDetails: { description: true },
      },
      live,
      snapshot
    )
    listProducts.mockResolvedValue([repaired, publishedFixture("shirt-b")])
    expect(await readPublishingHealth()).toMatchObject({ status: "healthy", issues: [] })
  })

  it.each([
    ["blueprint", "UNSUPPORTED_BLUEPRINT"],
    ["price", "INVALID_PRICE"],
    ["mockup", "INCOMPLETE_VARIANTS"],
    ["production", "SNAPSHOT_PRODUCTION_INVALID"],
  ])("alerts on a published %s defect without importing a valid live draft", async (change, code) => {
    const snapshot = publishedFixture("shirt-a")
    if (change === "blueprint") snapshot.blueprint_id = 999
    if (change === "price") snapshot.variants[0]!.price = 0
    if (change === "mockup") snapshot.images = []
    if (change === "production") Object.assign(snapshot.print_areas[0]!, { placeholders: "private-artwork" })
    listProducts.mockResolvedValue([snapshot, publishedFixture("shirt-b")])
    const result = await readPublishingHealth()
    expect(result).toMatchObject({ status: "unhealthy", issues: ["MERCHANT_CATALOG_INVALID"] })
    expect(console.error).toHaveBeenCalledWith("Merchant feed unavailable", {
      source: "publishing-health",
      code,
      productId: "shirt-a",
    })
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private-artwork")
  })

  it("reports an unreadable published catalog without fetching live drafts or logging connection details", async () => {
    listProducts.mockRejectedValue(new Error("postgres://private-password@localhost/database"))
    expect(await readPublishingHealth()).toMatchObject({ status: "unhealthy", issues: ["DATABASE_UNAVAILABLE"] })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledExactlyOnceWith("Merchant feed unavailable", {
      source: "publishing-health",
      code: "DATABASE_UNAVAILABLE",
    })
  })

  it("checks every active product with uncached read-token GETs and returns only fixed codes/counts", async () => {
    const result = await readPublishingHealth()
    expect(result).toEqual({
      status: "healthy",
      checkedAt: expect.any(String),
      issues: [],
      counts: { activeProducts: 2, attentionJobs: 0, overdueJobs: 0, checkedProducts: 2 },
    })
    expect(Number.isFinite(Date.parse(result.checkedAt))).toBe(true)
    expect(productFetch).toHaveBeenCalledTimes(2)
    for (const [url, options] of productFetch.mock.calls) {
      expect(String(url)).toMatch(/^https:\/\/api\.printify\.com\/v1\/shops\/123\/products\/shirt-[ab]\.json$/)
      expect(options).toMatchObject({
        method: "GET",
        cache: "no-store",
        redirect: "error",
        headers: { Authorization: "Bearer fixture-read-token" },
      })
    }
    expect(JSON.stringify(result)).not.toContain("shirt-")
    expect(JSON.stringify(result)).not.toContain("token")
  })

  it.each([false, true])("accepts either unused canvas flag without a publishing alert: %s", async (canvas) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const product = productFixture("shirt-a")
    Object.assign(product.print_areas[0]!, { country: "Honduras", canvas })
    productFetch.mockResolvedValueOnce(Response.json(product))
    expect(await readPublishingHealth()).toMatchObject({
      status: "healthy",
      issues: [],
      counts: { checkedProducts: 2 },
    })
    expect(log).not.toHaveBeenCalled()
  })

  it("reports disabled publishing without reading storage or Printify", async () => {
    config.PRINTIFY_PUBLISHING_ENABLED = false
    expect(await readPublishingHealth()).toMatchObject({ status: "unhealthy", issues: ["PUBLISHING_DISABLED"] })
    expect(getPublishingStore).not.toHaveBeenCalled()
    expect(productFetch).not.toHaveBeenCalled()
  })

  it("reports missing configuration without external calls", async () => {
    config.PRINTIFY_API_TOKEN = ""
    expect(await readPublishingHealth()).toMatchObject({ status: "unhealthy", issues: ["PUBLISHING_NOT_CONFIGURED"] })
    expect(getPublishingStore).not.toHaveBeenCalled()
    expect(productFetch).not.toHaveBeenCalled()
  })

  it("redacts database failures and does not probe the provider after storage fails", async () => {
    readHealth.mockRejectedValue(new Error("private database password"))
    const result = await readPublishingHealth()
    expect(result.issues).toEqual(["DATABASE_UNAVAILABLE"])
    expect(JSON.stringify(result)).not.toContain("private")
    expect(productFetch).not.toHaveBeenCalled()
  })

  it("reports attention and overdue jobs even while products remain valid", async () => {
    readHealth.mockResolvedValue({
      openJobProductIds: [],
      openJobProductCount: 0,
      activeProducts: 1,
      attentionJobs: 2,
      overdueJobs: 3,
      productIds: ["shirt-a"],
    })
    expect(await readPublishingHealth()).toMatchObject({
      status: "unhealthy",
      issues: ["ATTENTION_JOBS", "OVERDUE_JOBS"],
      counts: { attentionJobs: 2, overdueJobs: 3, checkedProducts: 1 },
    })
  })

  it("alerts on a current acknowledged publication failure without changing the public counts shape", async () => {
    readHealth.mockResolvedValue({
      activeProducts: 2,
      attentionJobs: 0,
      overdueJobs: 0,
      productIds: ["shirt-a", "shirt-b"],
      openJobProductIds: [],
      openJobProductCount: 0,
      failedPublications: 1,
    })
    expect(await readPublishingHealth()).toEqual({
      status: "unhealthy",
      checkedAt: expect.any(String),
      issues: ["FAILED_PUBLICATIONS"],
      counts: { activeProducts: 2, attentionJobs: 0, overdueJobs: 0, checkedProducts: 2 },
    })
  })

  it.each([404, 401, 429, 500])("reports provider HTTP %s without exposing its body", async (status) => {
    productFetch.mockResolvedValue(new Response("private provider details", { status }))
    const result = await readPublishingHealth()
    expect(result.status).toBe("unhealthy")
    expect(result.issues).toEqual([status === 404 ? "LIVE_PRODUCT_MISSING" : "PRINTIFY_UNAVAILABLE"])
    expect(JSON.stringify(result)).not.toContain("private")
  })

  it("ignores extra response attributes and malformed unused metadata without an alert", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const product = productFixture("shirt-a")
    const area = product.print_areas[0]!
    const placeholder = area.placeholders[0]!
    Object.assign(product, { print_details: { response_version: 2 } })
    Object.assign(area, { country: {}, canvas: [], response_version: 2 })
    Object.assign(placeholder, { response_version: 2 })
    Object.assign(placeholder.images[0]!, {
      src: null,
      name: [],
      imageId: {},
      response_version: 2,
      pattern: { spacing_x: 0.1, spacing_y: 0.2, angle: 30, offset: 0.5, response_version: 2 },
    })
    Object.assign(product.options[0]!, { name: null })
    productFetch.mockResolvedValueOnce(Response.json(product))

    expect(await readPublishingHealth()).toMatchObject({
      status: "healthy",
      issues: [],
      counts: { checkedProducts: 2 },
    })
    expect(log).not.toHaveBeenCalled()
  })

  it("detects malformed production geometry without exposing payload data", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const product = productFixture("shirt-a")
    Object.assign(product.print_areas[0]!.placeholders[0]!.images[0]!, {
      scale: "private invalid placement",
      private_unknown_field: "private artwork data",
    })
    productFetch.mockResolvedValueOnce(Response.json(product))
    const result = await readPublishingHealth()
    expect(result).toMatchObject({
      status: "unhealthy",
      issues: ["LIVE_PRODUCT_INVALID"],
      counts: { checkedProducts: 2 },
    })
    expect(log).toHaveBeenCalledWith("Printify production schema changed", {
      code: "PRODUCT_SCHEMA_DRIFT",
      productId: "shirt-a",
      shopId: "123",
    })
    expect(JSON.stringify(result)).not.toContain("private")
    expect(JSON.stringify(log.mock.calls)).not.toContain("private")
  })

  it.each([
    "product identity",
    "shop identity",
    "garment identity",
    "provider identity",
    "variant identity",
    "price",
    "stock flag",
    "enabled flag",
    "variant assignment",
    "artwork identity",
    "placement",
    "decoration method",
    "print setting",
  ])("reports invalid %s used by checkout or production comparison", async (field) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    const product = productFixture("shirt-a")
    const area = product.print_areas[0]!
    const placeholder = area.placeholders[0]!
    const image = placeholder.images[0]!
    if (field === "product identity") product.id = "another-shirt"
    if (field === "shop identity") product.shop_id = 999
    if (field === "garment identity") Object.assign(product, { blueprint_id: "1317" })
    if (field === "provider identity") Object.assign(product, { print_provider_id: "99" })
    if (field === "variant identity") Object.assign(product.variants[0]!, { id: "101" })
    if (field === "price") Object.assign(product.variants[0]!, { price: "3000" })
    if (field === "stock flag") Object.assign(product.variants[0]!, { is_available: "true" })
    if (field === "enabled flag") Object.assign(product.variants[0]!, { is_enabled: "true" })
    if (field === "variant assignment") area.variant_ids = []
    if (field === "artwork identity") image.id = ""
    if (field === "placement") Object.assign(image, { x: "0.5" })
    if (field === "decoration method") Object.assign(placeholder, { decoration_method: 123 })
    if (field === "print setting") Object.assign(product, { print_details: { print_on_side: 123 } })
    productFetch.mockResolvedValueOnce(Response.json(product))

    expect(await readPublishingHealth()).toMatchObject({
      status: "unhealthy",
      issues: ["LIVE_PRODUCT_INVALID"],
      counts: { checkedProducts: 2 },
    })
  })

  it("rejects malformed or wrong-product responses instead of calling them healthy", async () => {
    productFetch.mockResolvedValueOnce(Response.json(productFixture("other-shirt")))
    productFetch.mockResolvedValueOnce(Response.json({ private: "malformed" }))
    expect(await readPublishingHealth()).toMatchObject({ status: "unhealthy", issues: ["LIVE_PRODUCT_INVALID"] })
  })

  it("bounds the catalog and refuses to call a partial scan healthy", async () => {
    readHealth.mockResolvedValue({
      openJobProductIds: [],
      openJobProductCount: 0,
      activeProducts: 101,
      attentionJobs: 0,
      overdueJobs: 0,
      productIds: ["shirt-a"],
    })
    expect(await readPublishingHealth()).toMatchObject({
      issues: ["PRODUCT_LIMIT_EXCEEDED"],
      counts: { checkedProducts: 0 },
    })
    expect(productFetch).not.toHaveBeenCalled()
    readHealth.mockResolvedValue({
      openJobProductIds: [],
      openJobProductCount: 0,
      activeProducts: 2,
      attentionJobs: 0,
      overdueJobs: 0,
      productIds: ["shirt-a"],
    })
    expect(await readPublishingHealth()).toMatchObject({ status: "unhealthy", issues: ["CHECK_INCOMPLETE"] })
  })

  it("limits concurrent provider reads to four", async () => {
    const ids = Array.from({ length: 12 }, (_, index) => `shirt-${index}`)
    readHealth.mockResolvedValue({
      openJobProductIds: [],
      openJobProductCount: 0,
      activeProducts: ids.length,
      attentionJobs: 0,
      overdueJobs: 0,
      productIds: ids,
    })
    let pending = 0
    let peak = 0
    productFetch.mockImplementation(async (input) => {
      peak = Math.max(peak, ++pending)
      await new Promise((resolve) => setTimeout(resolve, 1))
      pending--
      return Response.json(
        productFixture(
          new URL(String(input)).pathname
            .split("/")
            .at(-1)!
            .replace(/\.json$/, "")
        )
      )
    })
    expect(await readPublishingHealth()).toMatchObject({ status: "healthy", counts: { checkedProducts: 12 } })
    expect(peak).toBe(4)
  })

  it("finds a missed publishing event for a locked draft outside the storefront", async () => {
    inventoryFetch.mockResolvedValue(
      Response.json({
        current_page: 1,
        last_page: 1,
        total: 1,
        data: [{ id: "never-published-draft", shop_id: 123, is_locked: true }],
      })
    )
    expect(await readPublishingHealth()).toMatchObject({ status: "unhealthy", issues: ["SOURCE_LOCK_WITHOUT_JOB"] })
    readHealth.mockResolvedValue({
      activeProducts: 2,
      attentionJobs: 0,
      overdueJobs: 0,
      productIds: ["shirt-a", "shirt-b"],
      openJobProductCount: 1,
      openJobProductIds: ["never-published-draft"],
    })
    inventoryFetch.mockImplementation(async () =>
      Response.json({
        current_page: 1,
        last_page: 1,
        total: 1,
        data: [{ id: "never-published-draft", shop_id: 123, is_locked: true }],
      })
    )
    expect(await readPublishingHealth()).toMatchObject({ status: "healthy", issues: [] })
  })

  it("validates both inventory pages and never requests an unbounded third page", async () => {
    inventoryFetch.mockImplementation(async (input) => {
      const page = Number(new URL(String(input)).searchParams.get("page"))
      return Response.json({
        current_page: page,
        last_page: 2,
        total: 51,
        data: Array.from({ length: page === 1 ? 50 : 1 }, (_, index) => ({
          id: `source-${(page - 1) * 50 + index}`,
          shop_id: 123,
          is_locked: false,
        })),
      })
    })
    expect(await readPublishingHealth()).toMatchObject({ status: "healthy" })
    expect(inventoryFetch).toHaveBeenCalledTimes(2)
    for (const [input, options] of inventoryFetch.mock.calls) {
      expect(new URL(String(input)).searchParams.get("limit")).toBe("50")
      expect(options).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" })
    }
  })

  it.each([
    "wrong-shop",
    "duplicate",
    "missing-total",
    "total-mismatch",
    "too-many-products",
    "too-many-pages",
    "wrong-page",
    "missing-lock",
  ])("does not claim a complete inventory scan for %s", async (failure) => {
    const product: Record<string, unknown> = { id: "source", shop_id: 123, is_locked: false }
    const inventory: Record<string, unknown> = { current_page: 1, last_page: 1, total: 1, data: [product] }
    if (failure === "wrong-shop") product.shop_id = 456
    if (failure === "duplicate") {
      inventory.data = [product, product]
      inventory.total = 2
    }
    if (failure === "missing-total") delete inventory.total
    if (failure === "total-mismatch") inventory.total = 25
    if (failure === "too-many-products") inventory.total = 101
    if (failure === "too-many-pages") inventory.last_page = 3
    if (failure === "wrong-page") inventory.current_page = 2
    if (failure === "missing-lock") delete product.is_locked
    inventoryFetch.mockImplementation(async () => Response.json(inventory))
    expect(await readPublishingHealth()).toMatchObject({
      status: "unhealthy",
      issues: ["INVENTORY_SCAN_INCOMPLETE"],
      counts: { checkedProducts: 2 },
    })
  })

  it.each(["metadata-change", "duplicate-across-pages"])("rejects %s between inventory pages", async (failure) => {
    inventoryFetch.mockImplementation(async (input) => {
      const page = Number(new URL(String(input)).searchParams.get("page"))
      return Response.json({
        current_page: page,
        last_page: 2,
        total: page === 2 && failure === "metadata-change" ? 52 : 51,
        data: Array.from({ length: page === 1 ? 50 : 1 }, (_, index) => ({
          id: page === 2 && failure === "duplicate-across-pages" ? "source-0" : `source-${(page - 1) * 50 + index}`,
          shop_id: 123,
          is_locked: false,
        })),
      })
    })
    expect(await readPublishingHealth()).toMatchObject({ status: "unhealthy", issues: ["INVENTORY_SCAN_INCOMPLETE"] })
    expect(inventoryFetch).toHaveBeenCalledTimes(2)
  })

  it.each([401, 429, 503])(
    "reports inventory HTTP %s with sanitized diagnostics and preserves other checks",
    async (status) => {
      inventoryFetch.mockResolvedValue(new Response("private inventory details", { status }))
      const result = await readPublishingHealth()
      expect(result).toMatchObject({
        status: "unhealthy",
        issues: ["INVENTORY_SCAN_INCOMPLETE", "PRINTIFY_UNAVAILABLE"],
        counts: { checkedProducts: 2 },
      })
      expect(console.error).toHaveBeenCalledExactlyOnceWith("Publishing inventory read failed", {
        code: "PRINTIFY_UNAVAILABLE",
        page: 1,
        phase: "status",
        status,
        elapsedMs: expect.any(Number),
      })
      expect(JSON.stringify({ result, logs: vi.mocked(console.error).mock.calls })).not.toContain("private")
    }
  )

  it("distinguishes an inventory connection failure from an HTTP response without logging error details", async () => {
    inventoryFetch.mockRejectedValue(new TypeError("private connection details"))
    const result = await readPublishingHealth()
    expect(result).toMatchObject({
      status: "unhealthy",
      issues: ["INVENTORY_SCAN_INCOMPLETE", "PRINTIFY_UNAVAILABLE"],
      counts: { checkedProducts: 2 },
    })
    expect(console.error).toHaveBeenCalledExactlyOnceWith("Publishing inventory read failed", {
      code: "PRINTIFY_UNAVAILABLE",
      page: 1,
      phase: "headers",
      elapsedMs: expect.any(Number),
    })
    expect(JSON.stringify({ result, logs: vi.mocked(console.error).mock.calls })).not.toContain("private")
  })

  it.each(["TimeoutError", "AbortError"])("identifies product %s without exposing error details", async (name) => {
    productFetch.mockRejectedValue(new DOMException("private provider details", name))
    const result = await readPublishingHealth()
    expect(result).toMatchObject({ status: "unhealthy", issues: ["PRINTIFY_TIMEOUT"] })
    expect(JSON.stringify(result)).not.toContain("private")
  })

  describe("inventory request deadlines", () => {
    beforeEach(() => {
      vi.useFakeTimers()
      // Native AbortSignal.timeout does not use Vitest's fake clock.
      vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
        const controller = new AbortController()
        setTimeout(() => controller.abort(new DOMException("Timeout", "TimeoutError")), milliseconds)
        return controller.signal
      })
    })
    afterEach(() => vi.useRealTimers())

    it("allows a sixteen-second inventory page within the scan budget", async () => {
      inventoryFetch.mockImplementation(
        (_input, options) =>
          new Promise((resolve, reject) => {
            options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason), { once: true })
            setTimeout(
              () =>
                resolve(
                  Response.json({
                    current_page: 1,
                    last_page: 1,
                    total: 2,
                    data: ["shirt-a", "shirt-b"].map((id) => ({ id, shop_id: 123, is_locked: false })),
                  })
                ),
              16_000
            )
          })
      )
      const result = readPublishingHealth()
      await vi.advanceTimersByTimeAsync(16_000)
      expect(await result).toMatchObject({ status: "healthy", issues: [], counts: { checkedProducts: 2 } })
    })

    it("checks 24 active products alongside two slow inventory pages within the overall budget", async () => {
      const ids = Array.from({ length: 24 }, (_, index) => `shirt-${index}`)
      readHealth.mockResolvedValue({
        openJobProductIds: [],
        openJobProductCount: 0,
        activeProducts: ids.length,
        attentionJobs: 0,
        overdueJobs: 0,
        productIds: ids,
      })
      let pending = 0
      let peak = 0
      fetchMock.mockImplementation(
        (input, options) =>
          new Promise((resolve, reject) => {
            const url = new URL(String(input))
            const inventory = url.pathname.endsWith("/products.json")
            peak = Math.max(peak, ++pending)
            const aborted = () => {
              pending--
              clearTimeout(timer)
              reject(options!.signal!.reason)
            }
            const timer = setTimeout(
              () => {
                pending--
                options!.signal!.removeEventListener("abort", aborted)
                const page = Number(url.searchParams.get("page"))
                resolve(
                  Response.json(
                    inventory
                      ? {
                          current_page: page,
                          last_page: 2,
                          total: 51,
                          data: Array.from({ length: page === 1 ? 50 : 1 }, (_, index) => ({
                            id: `source-${(page - 1) * 50 + index}`,
                            shop_id: 123,
                            is_locked: false,
                          })),
                        }
                      : productFixture(
                          url.pathname
                            .split("/")
                            .at(-1)!
                            .replace(/\.json$/, "")
                        )
                  )
                )
              },
              inventory ? 12_000 : 4_000
            )
            options!.signal!.addEventListener("abort", aborted, { once: true })
          })
      )
      const result = readPublishingHealth()
      await vi.advanceTimersByTimeAsync(40_000)
      expect(await result).toMatchObject({ status: "healthy", issues: [], counts: { checkedProducts: 24 } })
      expect(peak).toBeLessThanOrEqual(4)
      expect(pending).toBe(0)
    })

    it("accepts an inventory response taking twelve seconds and still checks active products", async () => {
      inventoryFetch.mockImplementation(
        (_input, options) =>
          new Promise((resolve, reject) => {
            options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason), { once: true })
            setTimeout(
              () =>
                resolve(
                  Response.json({
                    current_page: 1,
                    last_page: 1,
                    total: 2,
                    data: ["shirt-a", "shirt-b"].map((id) => ({ id, shop_id: 123, is_locked: false })),
                  })
                ),
              12_000
            )
          })
      )
      const result = readPublishingHealth()
      await vi.advanceTimersByTimeAsync(12_000)
      expect(await result).toMatchObject({ status: "healthy", issues: [], counts: { checkedProducts: 2 } })
    })

    it.each(["headers", "body"])("reports inventory timeout while awaiting %s and checks products", async (phase) => {
      inventoryFetch.mockImplementation((_input, options) => {
        const pending = new Promise<Response>((_resolve, reject) => {
          options!.signal!.addEventListener(
            "abort",
            () => reject(phase === "body" ? new DOMException("Aborted", "AbortError") : options!.signal!.reason),
            { once: true }
          )
        })
        if (phase === "headers") return pending
        const response = Response.json({})
        vi.spyOn(response, "json").mockImplementation(() => pending)
        return Promise.resolve(response)
      })
      const result = readPublishingHealth()
      await vi.advanceTimersByTimeAsync(30_000)
      expect(await result).toMatchObject({
        status: "unhealthy",
        issues: ["INVENTORY_SCAN_INCOMPLETE", "PRINTIFY_TIMEOUT"],
        counts: { checkedProducts: 2 },
      })
      expect(console.error).toHaveBeenCalledExactlyOnceWith("Publishing inventory read failed", {
        code: "PRINTIFY_TIMEOUT",
        page: 1,
        phase,
        elapsedMs: 30_000,
      })
    })

    it("shares thirty seconds across both pages and redacts a stalled second page", async () => {
      inventoryFetch.mockImplementation((input, options) => {
        const page = Number(new URL(String(input)).searchParams.get("page"))
        return new Promise((resolve, reject) => {
          options!.signal!.addEventListener(
            "abort",
            () => reject(new DOMException("private token and provider body", "AbortError")),
            { once: true }
          )
          if (page === 1)
            setTimeout(
              () =>
                resolve(
                  Response.json({
                    current_page: 1,
                    last_page: 2,
                    total: 51,
                    data: Array.from({ length: 50 }, (_, index) => ({
                      id: `source-${index}`,
                      shop_id: 123,
                      is_locked: true,
                    })),
                  })
                ),
              20_000
            )
        })
      })
      const pending = readPublishingHealth()
      await vi.advanceTimersByTimeAsync(30_000)
      const result = await pending
      expect(result).toMatchObject({
        status: "unhealthy",
        issues: ["INVENTORY_SCAN_INCOMPLETE", "PRINTIFY_TIMEOUT"],
        counts: { checkedProducts: 2 },
      })
      expect(inventoryFetch).toHaveBeenCalledTimes(2)
      expect(console.error).toHaveBeenCalledExactlyOnceWith("Publishing inventory read failed", {
        code: "PRINTIFY_TIMEOUT",
        page: 2,
        phase: "headers",
        elapsedMs: 10_000,
      })
      expect(JSON.stringify({ result, logs: vi.mocked(console.error).mock.calls })).not.toContain("private")
    })

    it("keeps the overall deadline when inventory starts after a slow database read", async () => {
      const snapshot = await readHealth()
      readHealth.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(snapshot), 30_000)))
      inventoryFetch.mockImplementation(
        (_input, options) =>
          new Promise((_resolve, reject) => {
            options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason), { once: true })
          })
      )
      const result = readPublishingHealth()
      await vi.advanceTimersByTimeAsync(40_000)
      expect(await result).toMatchObject({
        status: "unhealthy",
        issues: ["CHECK_INCOMPLETE", "INVENTORY_SCAN_INCOMPLETE"],
        counts: { checkedProducts: 2 },
      })
      expect(productFetch).toHaveBeenCalledTimes(2)
      expect(console.error).not.toHaveBeenCalled()
    })
  })

  it("does not classify source locks from a truncated set of open job products", async () => {
    readHealth.mockResolvedValue({
      activeProducts: 2,
      attentionJobs: 0,
      overdueJobs: 0,
      productIds: ["shirt-a", "shirt-b"],
      openJobProductCount: 501,
      openJobProductIds: [],
    })
    expect(await readPublishingHealth()).toMatchObject({ status: "unhealthy", issues: ["OPEN_JOB_LIMIT_EXCEEDED"] })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("aborts outstanding requests and stops starting new ones at the overall deadline", async () => {
    const deadline = new AbortController()
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation((milliseconds) => (milliseconds === 40_000 ? deadline.signal : new AbortController().signal))
    readHealth.mockResolvedValue({
      openJobProductIds: [],
      openJobProductCount: 0,
      activeProducts: 10,
      attentionJobs: 0,
      overdueJobs: 0,
      productIds: Array.from({ length: 10 }, (_, index) => `shirt-${index}`),
    })
    // Both pending fetches reject on cancellation, as real provider reads do.
    for (const providerFetch of [inventoryFetch, productFetch])
      providerFetch.mockImplementation(
        (_input, options) =>
          new Promise((_resolve, reject) => {
            options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason), { once: true })
          })
      )
    const result = readPublishingHealth()
    await vi.waitFor(() => expect(productFetch).toHaveBeenCalledTimes(3))
    deadline.abort(new DOMException("Timeout", "TimeoutError"))
    expect(await result).toMatchObject({
      status: "unhealthy",
      issues: ["CHECK_INCOMPLETE", "INVENTORY_SCAN_INCOMPLETE"],
      counts: { checkedProducts: 3 },
    })
    expect(productFetch).toHaveBeenCalledTimes(3)
    expect(inventoryFetch).toHaveBeenCalledTimes(1)
    expect(console.error).not.toHaveBeenCalled()
    expect(timeout).toHaveBeenCalledWith(5_000)
  })
})

function productFixture(id: string) {
  return {
    id,
    shop_id: 123,
    title: "Shirt",
    blueprint_id: 1317,
    print_provider_id: 99,
    print_areas: [
      {
        variant_ids: [101],
        placeholders: [{ position: "front", images: [{ id: "artwork", x: 0.5, y: 0.5, scale: 1, angle: 0 }] }],
      },
    ],
    variants: [{ id: 101, sku: "shirt-m", price: 3000, is_enabled: true, is_available: true, options: [1] }],
    options: [{ name: "Size", values: [{ id: 1, title: "M" }] }],
  }
}

function publishedFixture(id: string) {
  const product = productFixture(id)
  return {
    ...product,
    description: "A climbing shirt with a published description.",
    variants: product.variants.map((variant) => ({ ...variant, options: [1, 2] })),
    options: [
      { name: "Size", type: "size", values: [{ id: 1, title: "M" }] },
      { name: "Color", type: "color", values: [{ id: 2, title: "Black" }] },
    ],
    images: [{ src: "https://images.printify.com/shirt.png", variant_ids: [101], is_default: true }],
  }
}

it("includes catalog refresh warnings in the monitored health response", async () => {
  vi.mocked(readCatalogRefreshHealth).mockResolvedValue(["CATALOG_STOCK_STALE", "CATALOG_POPULARITY_STALE"])
  expect(await readPublishingHealth()).toMatchObject({
    status: "unhealthy",
    issues: ["CATALOG_POPULARITY_STALE", "CATALOG_STOCK_STALE"],
  })
})
