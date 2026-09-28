// @vitest-environment node
import { revalidatePath, revalidateTag } from "next/cache"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { backfillPublishedArtwork } from "@/features/publishing/backfill-published-artwork.server"
import { getPublishingStore } from "@/features/publishing/get-publishing-store.server"

import { POST } from "./route"

const config = vi.hoisted(() => ({
  CRON_SECRET: "fixture-secret" as string | undefined,
  PRINTIFY_PUBLISHING_ENABLED: true,
  ADMIN_LIBRARY_ENABLED: true,
  DATABASE_URL: "fixture-database" as string | undefined,
  PRINTIFY_SHOP_ID: "123" as string | undefined,
  NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST: "test.public.blob.vercel-storage.com" as string | undefined,
}))
vi.mock("server-only", () => ({}))
vi.mock("@/features/design-library/read-private-asset.server", () => ({ readPrivateAsset: vi.fn() }))
vi.mock("@/features/design-products/resolve-published-product-artwork.server", () => ({
  resolvePublishedProductArtwork: vi.fn(),
}))
vi.mock("@/lib/env", () => ({ env: config }))
vi.mock("next/cache", () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }))
vi.mock("@/features/publishing/backfill-published-artwork.server", () => ({ backfillPublishedArtwork: vi.fn() }))
vi.mock("@/features/publishing/get-publishing-store.server", () => ({ getPublishingStore: vi.fn() }))

const result = {
  mode: "apply" as const,
  products: { updated: [], unchanged: [], unmatched: [], partial: [], skipped: [], failed: [] },
  counts: { updated: 0, unchanged: 0, unmatched: 0, partial: 0, skipped: 0, failed: 0 },
  failures: [],
  cacheInvalidation: { status: "not-needed" as const },
  nextAfterProductId: null,
  hasMore: false,
}
function request(
  body = "{}",
  authorization: string | null = "Bearer fixture-secret",
  headers: Record<string, string> = {}
) {
  return new Request("https://shop.example/api/internal/product-artwork/backfill", {
    method: "POST",
    headers: { "content-type": "application/json", ...(authorization === null ? {} : { authorization }), ...headers },
    body,
  })
}

beforeEach(() => {
  config.CRON_SECRET = "fixture-secret"
  config.PRINTIFY_PUBLISHING_ENABLED = true
  config.ADMIN_LIBRARY_ENABLED = true
  config.DATABASE_URL = "fixture-database"
  config.PRINTIFY_SHOP_ID = "123"
  config.NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST = "test.public.blob.vercel-storage.com"
  vi.mocked(getPublishingStore).mockReturnValue({} as never)
  vi.mocked(backfillPublishedArtwork).mockResolvedValue(result)
})

describe("published artwork backfill route", () => {
  it("authenticates a bounded batch and composes immediate catalog invalidation", async () => {
    const response = await POST(request('{"limit":2}'))
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual(result)
    const [services, selection] = vi.mocked(backfillPublishedArtwork).mock.calls[0]!
    expect(selection).toEqual({ limit: 2 })
    expect(services.shopId).toBe("123")
    expect(services.blobHost).toBe(config.NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST)
    services.invalidate()
    expect(revalidateTag).toHaveBeenCalledWith("printify-published-catalog", { expire: 0 })
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout")
  })

  it("returns safe per-product dispositions and the batch cache outcome without hiding committed work", async () => {
    const updated = "000000000000000000000001"
    const failed = "000000000000000000000002"
    const report = {
      ...result,
      products: { ...result.products, updated: [updated], failed: [failed] },
      counts: { ...result.counts, updated: 1, failed: 1 },
      failures: [{ productId: failed, code: "IMAGE_STORAGE_CONFIGURATION" as const, disposition: "review" as const }],
      cacheInvalidation: {
        status: "failed" as const,
        code: "ARTWORK_CACHE_INVALIDATION_FAILED" as const,
        disposition: "retry" as const,
      },
    }
    vi.mocked(backfillPublishedArtwork).mockResolvedValueOnce(report)
    const response = await POST(request('{"limit":2}'))
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual(report)
  })

  it.each([null, "", "Bearer fixture-secrex", "Bearer incorrect", "Basic fixture-secret"])(
    "rejects invalid credentials before reading the body, database, or storage",
    async (authorization) => {
      const input = request("{not-json", authorization)
      const read = vi.spyOn(input.body!, "getReader")
      const response = await POST(input)
      expect(response.status).toBe(401)
      expect(response.headers.get("cache-control")).toBe("no-store")
      expect(read).not.toHaveBeenCalled()
      expect(getPublishingStore).not.toHaveBeenCalled()
      expect(backfillPublishedArtwork).not.toHaveBeenCalled()
    }
  )

  it.each(["CRON_SECRET", "DATABASE_URL", "PRINTIFY_SHOP_ID", "NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST"] as const)(
    "fails closed when %s is absent",
    async (key) => {
      config[key] = undefined
      const response = await POST(request())
      expect(response.status).toBe(503)
      expect(response.headers.get("cache-control")).toBe("no-store")
      expect(getPublishingStore).not.toHaveBeenCalled()
    }
  )

  it.each(["PRINTIFY_PUBLISHING_ENABLED", "ADMIN_LIBRARY_ENABLED"] as const)(
    "does not upload while %s is disabled",
    async (key) => {
      config[key] = false
      expect((await POST(request())).status).toBe(503)
      expect(getPublishingStore).not.toHaveBeenCalled()
    }
  )

  it.each([
    "not json",
    "[]",
    "null",
    '{"limit":6}',
    '{"limit":0}',
    '{"limit":1.5}',
    '{"productId":"https://example.com/image"}',
    '{"sourceUrl":"https://example.com/image"}',
    '{"blobHost":"different.public.blob.vercel-storage.com"}',
    '{"token":"secret"}',
    '{"productId":"000000000000000000000001","afterProductId":"000000000000000000000002"}',
  ])("rejects malformed or broadened selections before storage access", async (body) => {
    const response = await POST(request(body))
    expect(response.status).toBe(400)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(getPublishingStore).not.toHaveBeenCalled()
  })

  it.each([{ "content-length": "1025" }, { "content-length": "bad" }, { "content-type": "text/plain" }] as Record<
    string,
    string
  >[])("rejects invalid request metadata", async (headers) => {
    const response = await POST(request("{}", "Bearer fixture-secret", headers))
    expect(response.status).toBe(400)
    expect(getPublishingStore).not.toHaveBeenCalled()
  })

  it.each([{}, { "content-length": "2" }] as Record<string, string>[])(
    "enforces the actual body cap independently of declared content length",
    async (headers) => {
      const response = await POST(request(`{"padding":"${"a".repeat(1_024)}"}`, "Bearer fixture-secret", headers))
      expect(response.status).toBe(400)
      expect(getPublishingStore).not.toHaveBeenCalled()
    }
  )

  it("does not expose database or provider errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    vi.mocked(backfillPublishedArtwork).mockRejectedValueOnce(new Error("sensitive-provider-response"))
    const response = await POST(request())
    expect(response.status).toBe(500)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.text()).not.toContain("sensitive")
    expect(vi.mocked(console.error).mock.calls).toEqual([["Published artwork backfill could not complete"]])
  })
})
