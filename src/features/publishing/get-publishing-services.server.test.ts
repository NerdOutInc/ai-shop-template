// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import { readPrivateAsset } from "@/features/design-library/read-private-asset.server"
import { resolvePublishedProductArtwork } from "@/features/design-products/resolve-published-product-artwork.server"
import { markDesignProductRemoved } from "@/features/design-products/mark-design-product-removed.server"
import { markDesignProductUnverified } from "@/features/design-products/mark-design-product-unverified.server"
import { markDesignProductPublished } from "@/features/design-products/mark-design-product-published.server"
import { hostPublishedArtwork } from "./host-published-artwork.server"
import { getPublishingServices } from "./get-publishing-services.server"
import { getPublishingStore } from "./get-publishing-store.server"
import { hostPublishedImages } from "./host-published-images.server"
import { PrintifyPublishingClient } from "./printify-publishing-client.server"
import { processPublishingJobs } from "./process-publishing-jobs.server"

const configuration = vi.hoisted(() => ({
  PRINTIFY_PUBLISHING_ENABLED: true,
  ADMIN_LIBRARY_ENABLED: false,
  PRINTIFY_PUBLISHING_API_TOKEN: "synthetic-publishing-token",
  PRINTIFY_SHOP_ID: "123",
  NEXT_PUBLIC_SITE_URL: "https://example.com",
  NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST: "catalog.public.blob.vercel-storage.com" as string | undefined,
}))

vi.mock("@/features/design-library/read-private-asset.server", () => ({ readPrivateAsset: vi.fn() }))
vi.mock("@/features/design-products/resolve-published-product-artwork.server", () => ({
  resolvePublishedProductArtwork: vi.fn(),
}))
vi.mock("@/features/design-products/mark-design-product-published.server", () => ({
  markDesignProductPublished: vi.fn(),
}))
vi.mock("@/features/design-products/mark-design-product-removed.server", () => ({ markDesignProductRemoved: vi.fn() }))
vi.mock("@/features/design-products/mark-design-product-unverified.server", () => ({
  markDesignProductUnverified: vi.fn(),
}))
vi.mock("./host-published-artwork.server", () => ({ hostPublishedArtwork: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/env", () => ({ env: configuration }))
vi.mock("./get-publishing-store.server", () => ({ getPublishingStore: vi.fn() }))
vi.mock("./host-published-images.server", () => ({ hostPublishedImages: vi.fn() }))
vi.mock("./printify-publishing-client.server", () => ({ PrintifyPublishingClient: vi.fn(class {}) }))
vi.mock("./process-publishing-jobs.server", () => ({ processPublishingJobs: vi.fn() }))

beforeEach(() => {
  configuration.ADMIN_LIBRARY_ENABLED = false
  configuration.NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST = "catalog.public.blob.vercel-storage.com"
})

describe("publishing service image configuration", () => {
  it("does not call the private library or require its migrations when admin is disabled", async () => {
    await getPublishingServices().processPending()
    const worker = vi.mocked(processPublishingJobs).mock.calls[0]![0]
    expect(worker.hostArtwork).toBeUndefined()
    expect(worker.markArtworkPublished).toBeUndefined()
    expect(worker.markArtworkRemoved).toBeUndefined()
    expect(worker.markArtworkUnverified).toBeUndefined()
    expect(resolvePublishedProductArtwork).not.toHaveBeenCalled()
    expect(readPrivateAsset).not.toHaveBeenCalled()
    expect(markDesignProductPublished).not.toHaveBeenCalled()
  })

  it("passes the publication source and deadline to exact artwork recovery when the library is enabled", async () => {
    configuration.ADMIN_LIBRARY_ENABLED = true
    await getPublishingServices().processPending()
    const worker = vi.mocked(processPublishingJobs).mock.calls[0]![0]
    const input = {
      snapshot: {},
      source: {},
      expected: { shopId: "123", productId: "shirt" },
      revisionKey: "revision",
      uploads: { read: vi.fn(async () => null), save: vi.fn(async () => undefined) },
      deadline: 30000,
    }
    await worker.hostArtwork!(input)
    expect(hostPublishedArtwork).toHaveBeenCalledExactlyOnceWith({
      ...input,
      blobHost: configuration.NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST,
      readApproved: expect.any(Function),
      readAsset: readPrivateAsset,
    })
    const expected = { ...input.expected, productionFingerprint: "artwork-v1:fixture" }
    await vi.mocked(hostPublishedArtwork).mock.calls[0]![0].readApproved(expected)
    expect(resolvePublishedProductArtwork).toHaveBeenCalledExactlyOnceWith({
      ...expected,
      source: input.source,
      deadline: input.deadline,
    })
    expect(worker.markArtworkPublished).toBe(markDesignProductPublished)
    expect(worker.markArtworkRemoved).toBe(markDesignProductRemoved)
    expect(worker.markArtworkUnverified).toBe(markDesignProductUnverified)
  })

  it.each([undefined, ""])("leaves jobs untouched when the Blob host is %s", (host) => {
    configuration.NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST = host
    expect(() => getPublishingServices()).toThrow("Publishing is not configured")
    expect(getPublishingStore).not.toHaveBeenCalled()
    expect(PrintifyPublishingClient).not.toHaveBeenCalled()
    expect(processPublishingJobs).not.toHaveBeenCalled()
    expect(hostPublishedImages).not.toHaveBeenCalled()
  })

  it("passes the configured host to the uploader when processing resumes", async () => {
    const services = getPublishingServices()
    await services.processPending(5)
    const worker = vi.mocked(processPublishingJobs).mock.calls[0]!
    expect(worker[1]).toBe(5)
    const input = {
      snapshot: { images: [] },
      revisionKey: "publication-revision",
      uploads: { read: vi.fn(async () => null), save: vi.fn(async () => undefined) },
      deadline: 30_000,
    }
    await worker[0].hostImages(input)
    expect(hostPublishedImages).toHaveBeenCalledWith({
      ...input,
      blobHost: "catalog.public.blob.vercel-storage.com",
    })
  })
})
