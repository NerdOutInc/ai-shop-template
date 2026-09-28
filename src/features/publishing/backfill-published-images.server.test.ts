// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { backfillPublishedImages } from "./backfill-published-images.server"
import type { hostPublishedImages } from "./host-published-images.server"
import { PublishedImageError } from "./published-image-error"
import type { PublishingRecord, PublishingStore } from "./publishing-store"

vi.mock("server-only", () => ({}))

const first = "000000000000000000000001"
const second = "000000000000000000000002"
const third = "000000000000000000000003"
const source = {
  id: first,
  title: "Published shirt",
  images: [{ src: "https://images-api.printify.com/mockup/old", variant_ids: [1] }],
}
const images = [
  { src: `https://test.public.blob.vercel-storage.com/published-mockups/v1/${"a".repeat(64)}.jpg`, variant_ids: [1] },
]
const hostImages = vi.fn<typeof hostPublishedImages>()
const getImageBackfill = vi.fn<PublishingRecord["getImageBackfill"]>()
const replaceProductImages = vi.fn<PublishingRecord["replaceProductImages"]>()
const imageUploads = { read: vi.fn(), save: vi.fn() }
const record = { getImageBackfill, replaceProductImages, imageUploads } as unknown as PublishingRecord
const withProductLock =
  vi.fn<(productId: string, callback: (record: PublishingRecord) => Promise<unknown>) => Promise<unknown>>()
const listProductIds = vi.fn<() => Promise<string[]>>()
const invalidate = vi.fn()
const services = {
  store: { withProductLock: withProductLock as PublishingStore["withProductLock"], listProductIds },
  shopId: "123",
  blobHost: "test.public.blob.vercel-storage.com",
  hostImages,
  invalidate,
  now: () => 1_000,
}

beforeEach(() => {
  listProductIds.mockResolvedValue([first, second, third])
  getImageBackfill.mockResolvedValue({ revision: "7", snapshot: source })
  replaceProductImages.mockResolvedValue(true)
  hostImages.mockResolvedValue({ snapshot: { ...source, images }, complete: true })
  withProductLock.mockImplementation(async (_, callback) => callback(record))
})

describe("published image backfill", () => {
  it("copies the frozen revision, then commits only images and invalidates its cache", async () => {
    const result = await backfillPublishedImages(services, { productId: first })
    expect(hostImages).toHaveBeenCalledWith({
      snapshot: source,
      revisionKey: `backfill:123:${first}:7`,
      uploads: imageUploads,
      deadline: 41_000,
      blobHost: services.blobHost,
      now: services.now,
      maxImages: 10,
    })
    expect(replaceProductImages).toHaveBeenCalledWith("7", images)
    expect(replaceProductImages.mock.invocationCallOrder[0]).toBeGreaterThan(hostImages.mock.invocationCallOrder[0]!)
    expect(invalidate.mock.invocationCallOrder[0]).toBeGreaterThan(replaceProductImages.mock.invocationCallOrder[0]!)
    expect(result.products.updated).toEqual([first])
    expect(result.cacheInvalidation).toEqual({ status: "complete" })
    expect(listProductIds).not.toHaveBeenCalled()
  })

  it("leaves the old snapshot active when uploads are incomplete", async () => {
    hostImages.mockResolvedValueOnce({ snapshot: { ...source, images }, complete: false })
    const result = await backfillPublishedImages(services, { productId: first })
    expect(result.products.partial).toEqual([first])
    expect(replaceProductImages).not.toHaveBeenCalled()
    expect(invalidate).not.toHaveBeenCalled()
    expect(result.cacheInvalidation).toEqual({ status: "not-needed" })
  })

  it("does not upload for a hidden product or product with an open publication", async () => {
    getImageBackfill.mockResolvedValueOnce(null)
    const result = await backfillPublishedImages(services, { productId: first })
    expect(result.products.skipped).toEqual([first])
    expect(hostImages).not.toHaveBeenCalled()
  })

  it("does not overwrite a new revision or publication that arrived during uploading", async () => {
    replaceProductImages.mockResolvedValueOnce(false)
    const result = await backfillPublishedImages(services, { productId: first })
    expect(result.products.skipped).toEqual([first])
    expect(invalidate).not.toHaveBeenCalled()
  })

  it("skips a busy worker without waiting for its product lock", async () => {
    withProductLock.mockResolvedValueOnce(null)
    const result = await backfillPublishedImages(services, { productId: first })
    expect(result.products.skipped).toEqual([first])
    expect(hostImages).not.toHaveBeenCalled()
  })

  it("invalidates already hosted images without creating another revision", async () => {
    getImageBackfill.mockResolvedValueOnce({ revision: "8", snapshot: { ...source, images } })
    const result = await backfillPublishedImages(services, { productId: first })
    expect(result.products.unchanged).toEqual([first])
    expect(replaceProductImages).not.toHaveBeenCalled()
    expect(invalidate).toHaveBeenCalledOnce()
  })

  it("invalidates once after a batch containing updated and already hosted products", async () => {
    getImageBackfill.mockResolvedValueOnce({ revision: "7", snapshot: source })
    getImageBackfill.mockResolvedValueOnce({ revision: "8", snapshot: { ...source, images } })
    const result = await backfillPublishedImages(services, { limit: 2 })
    expect(result.products.updated).toEqual([first])
    expect(result.products.unchanged).toEqual([second])
    expect(invalidate).toHaveBeenCalledOnce()
    expect(invalidate.mock.invocationCallOrder[0]).toBeGreaterThan(hostImages.mock.invocationCallOrder[1]!)
    expect(result.cacheInvalidation).toEqual({ status: "complete" })
  })

  it("reports cache refresh failure separately without relabeling committed products", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    invalidate.mockImplementationOnce(() => {
      throw new Error("private invalidation error")
    })
    const result = await backfillPublishedImages(services, { productId: first })
    expect(replaceProductImages).toHaveBeenCalledOnce()
    expect(result.products.updated).toEqual([first])
    expect(result.products.failed).toEqual([])
    expect(result.failures).toEqual([])
    expect(result.cacheInvalidation).toEqual({
      status: "failed",
      code: "IMAGE_CACHE_INVALIDATION_FAILED",
      disposition: "retry",
    })
    expect(invalidate).toHaveBeenCalledOnce()
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("private invalidation error")
  })

  it("uses a bounded, ordered batch and an explicit continuation cursor", async () => {
    listProductIds.mockResolvedValueOnce([third, first, second])
    const result = await backfillPublishedImages(services, { afterProductId: first, limit: 1 })
    expect(withProductLock).toHaveBeenCalledOnce()
    expect(withProductLock.mock.calls[0]?.[0]).toBe(second)
    expect(result.nextAfterProductId).toBe(second)
    expect(result.hasMore).toBe(true)
  })

  it("stops starting products when the invocation budget is exhausted", async () => {
    const now = vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(1_000).mockReturnValue(39_000)
    const result = await backfillPublishedImages({ ...services, now })
    expect(withProductLock).toHaveBeenCalledOnce()
    expect(result.nextAfterProductId).toBe(first)
    expect(result.hasMore).toBe(true)
  })

  it("continues after an unknown failure and reports a safe review code", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    hostImages.mockRejectedValueOnce(new Error("sensitive storage provider URL or token"))
    const result = await backfillPublishedImages(services, { limit: 2 })
    expect(result.products.failed).toEqual([first])
    expect(result.products.updated).toEqual([second])
    expect(result.failures).toEqual([{ productId: first, code: "IMAGE_BACKFILL_UNKNOWN", disposition: "review" }])
    expect(JSON.stringify(result)).not.toContain("sensitive")
    expect(vi.mocked(console.warn).mock.calls).toEqual([
      [
        "Published image backfill needs retry or review",
        { productId: first, code: "IMAGE_BACKFILL_UNKNOWN", disposition: "review" },
      ],
    ])
  })

  it.each([
    ["IMAGE_SOURCE_UNAVAILABLE", true, "retry"],
    ["IMAGE_STORAGE_UNAVAILABLE", true, "retry"],
    ["IMAGE_RECEIPT_UNAVAILABLE", true, "retry"],
    ["IMAGE_SOURCE_INVALID", false, "review"],
    ["IMAGE_SOURCE_CHANGED", false, "review"],
    ["IMAGE_CONTENT_INVALID", false, "review"],
    ["IMAGE_STORAGE_CONFIGURATION", false, "review"],
    ["IMAGE_STORAGE_CONFLICT", false, "review"],
  ] as const)("preserves the safe code and disposition for %s", async (code, retryable, disposition) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const error = new PublishedImageError(code, retryable)
    error.message = "sensitive provider response"
    hostImages.mockRejectedValueOnce(error)
    const result = await backfillPublishedImages(services, { productId: first })
    expect(result.products.failed).toEqual([first])
    expect(result.failures).toEqual([{ productId: first, code, disposition }])
    expect(vi.mocked(console.warn).mock.calls).toEqual([
      ["Published image backfill needs retry or review", { productId: first, code, disposition }],
    ])
    expect(replaceProductImages).not.toHaveBeenCalled()
    expect(invalidate).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain("sensitive")
  })

  it.each([
    { limit: 0 },
    { limit: 6 },
    { limit: 1.5 },
    { productId: "https://other.example/image" },
    { productId: first, afterProductId: second },
  ])("rejects invalid work selection before database reads", async (selection) => {
    await expect(backfillPublishedImages(services, selection)).rejects.toThrow("Invalid image backfill selection")
    expect(listProductIds).not.toHaveBeenCalled()
    expect(withProductLock).not.toHaveBeenCalled()
  })
})
