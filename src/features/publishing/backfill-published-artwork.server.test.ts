// @vitest-environment node
import { execFile } from "node:child_process"
import { createServer } from "node:http"
import { fileURLToPath } from "node:url"

import { beforeEach, describe, expect, it, vi } from "vitest"

import { productArtworkFingerprint } from "@/features/design-products/product-artwork-fingerprint"

import { backfillPublishedArtwork } from "./backfill-published-artwork.server"
import { hostPublishedArtwork } from "./host-published-artwork.server"
import { PublishedImageError } from "./published-image-error"
import type { PublishingRecord, PublishingStore } from "./publishing-store"

vi.mock("server-only", () => ({}))

const first = "000000000000000000000001"
const second = "000000000000000000000002"
const third = "000000000000000000000003"
const source = {
  id: first,
  shop_id: 123,
  title: "Published shirt",
  blueprint_id: 1317,
  print_provider_id: 99,
  print_areas: [
    {
      variant_ids: [101],
      placeholders: [{ position: "front", images: [{ id: "approved-art-v1", x: 0.5, y: 0.5, scale: 1, angle: 0 }] }],
    },
  ],
  variants: [{ id: 101, sku: "navy-m", price: 3000, is_enabled: true, is_available: true, options: [1] }],
  options: [{ name: "Colors", type: "color", values: [{ id: 1, title: "Navy", colors: ["#101825"] }] }],
  images: [{ src: "https://images-api.printify.com/mockup/old", variant_ids: [101] }],
  storefront_artwork_enabled: false,
}
const artwork = {
  src: `https://test.public.blob.vercel-storage.com/published-artwork/v1/${"a".repeat(64)}.webp`,
  revisionId: "34d7df72-f329-45f9-acd5-faa4a0c10e25",
  productionFingerprint: productArtworkFingerprint(source, { shopId: "123", productId: first })!,
  sourceSha256: "b".repeat(64),
  sha256: "a".repeat(64),
  width: 900,
  height: 1200,
}
const hostArtwork = vi.fn<typeof hostPublishedArtwork>()
const getImageBackfill = vi.fn<PublishingRecord["getImageBackfill"]>()
const replaceProductArtwork = vi.fn<PublishingRecord["replaceProductArtwork"]>()
const imageUploads = { read: vi.fn(), save: vi.fn() }
const record = { getImageBackfill, replaceProductArtwork, imageUploads } as unknown as PublishingRecord
const withProductLock =
  vi.fn<(productId: string, callback: (record: PublishingRecord) => Promise<unknown>) => Promise<unknown>>()
const listProductIds = vi.fn<() => Promise<string[]>>()
const invalidate = vi.fn<() => Promise<void>>(async () => undefined)
const readApproved = vi.fn(async () => null)
const readAsset = vi.fn(async () => null)
const services = {
  store: { withProductLock: withProductLock as PublishingStore["withProductLock"], listProductIds },
  shopId: "123",
  blobHost: "test.public.blob.vercel-storage.com",
  hostArtwork,
  readApproved,
  readAsset,
  invalidate,
  now: () => 1_000,
}

beforeEach(() => {
  listProductIds.mockResolvedValue([first, second, third])
  getImageBackfill.mockResolvedValue({ revision: "7", snapshot: source })
  replaceProductArtwork.mockResolvedValue(true)
  hostArtwork.mockResolvedValue({
    snapshot: { ...source, storefront_artwork: artwork, storefront_artwork_enabled: true },
    complete: true,
  })
  withProductLock.mockImplementation(async (_, callback) => callback(record))
})

describe("published artwork backfill", () => {
  it("uses the frozen publication as its production source and commits only verified artwork", async () => {
    const result = await backfillPublishedArtwork(services, { productId: first })
    expect(hostArtwork).toHaveBeenCalledWith({
      snapshot: source,
      source,
      expected: { shopId: "123", productId: first },
      revisionKey: `artwork-backfill:123:${first}:7`,
      uploads: imageUploads,
      deadline: 41_000,
      blobHost: services.blobHost,
      now: services.now,
      readApproved: expect.any(Function),
      readAsset,
    })
    await hostArtwork.mock.calls[0]![0].readApproved({
      shopId: "123",
      productId: first,
      productionFingerprint: artwork.productionFingerprint,
    })
    expect(readApproved).toHaveBeenCalledWith({
      shopId: "123",
      productId: first,
      productionFingerprint: artwork.productionFingerprint,
      source,
      deadline: 41_000,
    })
    expect(replaceProductArtwork).toHaveBeenCalledWith("7", artwork)
    expect(invalidate.mock.invocationCallOrder[0]).toBeGreaterThan(replaceProductArtwork.mock.invocationCallOrder[0]!)
    expect(result.products.updated).toEqual([first])
    expect(result.cacheInvalidation).toEqual({ status: "complete" })
    expect(listProductIds).not.toHaveBeenCalled()
  })

  it("ignores unrelated returned fields instead of publishing draft metadata", async () => {
    hostArtwork.mockResolvedValueOnce({
      snapshot: {
        title: "Unpublished title",
        images: [],
        storefront_artwork: artwork,
        storefront_artwork_enabled: true,
      },
      complete: true,
    })
    expect((await backfillPublishedArtwork(services, { productId: first })).products.updated).toEqual([first])
    expect(replaceProductArtwork).toHaveBeenCalledExactlyOnceWith("7", artwork)
  })

  it("preserves an existing valid public artwork preview without resolving or uploading again", async () => {
    getImageBackfill.mockResolvedValueOnce({
      revision: "8",
      snapshot: { ...source, storefront_artwork: artwork, storefront_artwork_enabled: true },
    })
    const result = await backfillPublishedArtwork(services, { productId: first })
    expect(result.products.unchanged).toEqual([first])
    expect(hostArtwork).not.toHaveBeenCalled()
    expect(replaceProductArtwork).not.toHaveBeenCalled()
    expect(invalidate).toHaveBeenCalledOnce()
  })

  it("leaves missing or ambiguous artwork unmatched without changing the saved snapshot", async () => {
    hostArtwork.mockImplementationOnce(hostPublishedArtwork)
    const result = await backfillPublishedArtwork(services, { productId: first })
    expect(result.products.unmatched).toEqual([first])
    expect(result.products.failed).toEqual([])
    expect(result.failures).toEqual([])
    expect(readApproved).toHaveBeenCalledOnce()
    expect(readAsset).not.toHaveBeenCalled()
    expect(imageUploads.read).not.toHaveBeenCalled()
    expect(imageUploads.save).not.toHaveBeenCalled()
    expect(replaceProductArtwork).not.toHaveBeenCalled()
    expect(invalidate).not.toHaveBeenCalled()
  })

  it("keeps mixed updated and unresolved results plus the resume cursor readable by the apply CLI", async () => {
    const unmatchedSource = { ...source, id: second }
    getImageBackfill
      .mockResolvedValueOnce({ revision: "7", snapshot: source })
      .mockResolvedValueOnce({ revision: "8", snapshot: unmatchedSource })
    hostArtwork
      .mockResolvedValueOnce({
        snapshot: { ...source, storefront_artwork: artwork, storefront_artwork_enabled: true },
        complete: true,
      })
      .mockImplementationOnce(hostPublishedArtwork)

    const result = await backfillPublishedArtwork(services, { limit: 2 })
    expect(result.products).toEqual({
      updated: [first],
      unchanged: [],
      unmatched: [second],
      partial: [],
      skipped: [],
      failed: [],
    })
    expect(result.failures).toEqual([])
    expect(result.nextAfterProductId).toBe(second)
    expect(result.hasMore).toBe(true)
    expect(replaceProductArtwork).toHaveBeenCalledExactlyOnceWith("7", artwork)
    expect(readApproved).toHaveBeenCalledExactlyOnceWith({
      shopId: "123",
      productId: second,
      productionFingerprint: productArtworkFingerprint(unmatchedSource, { shopId: "123", productId: second }),
      source: unmatchedSource,
      deadline: 41_000,
    })
    expect(readAsset).not.toHaveBeenCalled()
    expect(imageUploads.read).not.toHaveBeenCalled()
    expect(imageUploads.save).not.toHaveBeenCalled()
    expect(invalidate).toHaveBeenCalledOnce()

    // Exercise the real strict CLI response parser; an unknown failure code would hide this whole batch.
    const server = createServer((_, response) => {
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify(result))
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    try {
      const address = server.address()
      if (!address || typeof address === "string") throw new Error("Missing local backfill test server")
      const output = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
        execFile(
          process.execPath,
          [
            "--conditions=react-server",
            "--import=tsx",
            "scripts/printify/backfill-published-artwork.ts",
            "--apply",
            "--limit",
            "2",
          ],
          {
            cwd: fileURLToPath(new URL("../../../", import.meta.url)),
            env: {
              NODE_ENV: "test",
              CRON_SECRET: "local-backfill-test-secret".repeat(2),
              NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${address.port}`,
            },
            timeout: 10_000,
          },
          (error, stdout, stderr) => {
            if (error && error.code !== 1) reject(error)
            else resolve({ code: error ? 1 : 0, stdout, stderr })
          }
        )
      })
      expect(output.code).toBe(1)
      expect(output.stderr).toBe("")
      expect(JSON.parse(output.stdout)).toEqual(result)
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  })

  it("leaves the previous snapshot active while a derivative is incomplete", async () => {
    hostArtwork.mockResolvedValueOnce({ snapshot: source, complete: false })
    const result = await backfillPublishedArtwork(services, { productId: first })
    expect(result.products.partial).toEqual([first])
    expect(replaceProductArtwork).not.toHaveBeenCalled()
  })

  it.each([
    { src: "https://private.private.blob.vercel-storage.com/master.png" },
    { src: `https://other.public.blob.vercel-storage.com/published-artwork/v1/${"a".repeat(64)}.webp` },
    { productionFingerprint: `artwork-v1:${"c".repeat(64)}` },
    { sha256: "d".repeat(64) },
    { width: 4000 },
  ])("rejects an invalid, private, or different production preview: %j", async (change) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    hostArtwork.mockResolvedValueOnce({
      snapshot: { ...source, storefront_artwork: { ...artwork, ...change }, storefront_artwork_enabled: true },
      complete: true,
    })
    const result = await backfillPublishedArtwork(services, { productId: first })
    expect(result.failures).toEqual([{ productId: first, code: "IMAGE_SOURCE_CHANGED", disposition: "review" }])
    expect(replaceProductArtwork).not.toHaveBeenCalled()
  })

  it("does not upload for an inactive product or a pending publication", async () => {
    getImageBackfill.mockResolvedValueOnce(null)
    expect((await backfillPublishedArtwork(services, { productId: first })).products.skipped).toEqual([first])
    expect(hostArtwork).not.toHaveBeenCalled()
  })

  it("does not overwrite a new publication or revision that arrives during uploading", async () => {
    replaceProductArtwork.mockResolvedValueOnce(false)
    expect((await backfillPublishedArtwork(services, { productId: first })).products.skipped).toEqual([first])
    expect(invalidate).not.toHaveBeenCalled()
  })

  it("skips a busy worker without waiting for its product lock", async () => {
    withProductLock.mockResolvedValueOnce(null)
    expect((await backfillPublishedArtwork(services, { productId: first })).products.skipped).toEqual([first])
    expect(hostArtwork).not.toHaveBeenCalled()
  })

  it("reports a failed asynchronous cache refresh without relabeling committed products", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    invalidate.mockRejectedValueOnce(new Error("private cache response"))
    const result = await backfillPublishedArtwork(services, { productId: first })
    expect(result.products.updated).toEqual([first])
    expect(result.products.failed).toEqual([])
    expect(result.cacheInvalidation).toEqual({
      status: "failed",
      code: "ARTWORK_CACHE_INVALIDATION_FAILED",
      disposition: "retry",
    })
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("private cache response")
  })

  it("uses bounded ordered batches and stops before its deadline", async () => {
    listProductIds.mockResolvedValueOnce([third, first, second])
    getImageBackfill.mockResolvedValue(null)
    const result = await backfillPublishedArtwork(services, { afterProductId: first, limit: 1 })
    expect(withProductLock).toHaveBeenCalledExactlyOnceWith(second, expect.any(Function))
    expect(result.nextAfterProductId).toBe(second)
    expect(result.hasMore).toBe(true)
    const now = vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(1_000).mockReturnValue(39_000)
    const stopped = await backfillPublishedArtwork({ ...services, now })
    expect(stopped.nextAfterProductId).toBe(first)
    expect(stopped.hasMore).toBe(true)
  })

  it.each([
    [new PublishedImageError("IMAGE_SOURCE_UNAVAILABLE", true), "IMAGE_SOURCE_UNAVAILABLE", "retry"],
    [new PublishedImageError("IMAGE_STORAGE_CONFLICT", false), "IMAGE_STORAGE_CONFLICT", "review"],
    [new Error("sensitive provider response"), "ARTWORK_BACKFILL_UNKNOWN", "review"],
  ])("reports safe retry or review information after failure", async (error, code, disposition) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    hostArtwork.mockRejectedValueOnce(error)
    const result = await backfillPublishedArtwork(services, { productId: first })
    expect(result.failures).toEqual([{ productId: first, code, disposition }])
    expect(JSON.stringify(result)).not.toContain("sensitive")
    expect(replaceProductArtwork).not.toHaveBeenCalled()
  })

  it.each([
    { limit: 0 },
    { limit: 6 },
    { limit: 1.5 },
    { productId: "invalid" },
    { productId: first, afterProductId: second },
  ])("rejects invalid selection before database reads", async (selection) => {
    await expect(backfillPublishedArtwork(services, selection)).rejects.toThrow("Invalid artwork backfill selection")
    expect(withProductLock).not.toHaveBeenCalled()
    expect(listProductIds).not.toHaveBeenCalled()
  })
})
