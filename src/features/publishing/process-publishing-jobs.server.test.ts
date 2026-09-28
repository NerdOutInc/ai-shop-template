// @vitest-environment node
import { describe, expect, it, vi } from "vitest"

import { mergePublishedProduct } from "./merge-published-product"
import { processPublishingJobs } from "./process-publishing-jobs.server"
import { PrintifyRequestError } from "./printify-request-error"
import { PublishedImageError } from "./published-image-error"
import type { PublishingEvent } from "./publishing-event"
import { publishingSourceFingerprint } from "./publishing-source-fingerprint"
import type { PublishingJob, PublishingRecord, PublishingStore } from "./publishing-store"

vi.mock("server-only", () => ({}))
vi.mock("./merge-published-product", () => ({ mergePublishedProduct: vi.fn() }))
vi.mock("./publishing-source-fingerprint", () => ({ publishingSourceFingerprint: vi.fn() }))

function setup({ firstPublication = false } = {}) {
  const event: PublishingEvent = {
    id: "image-publication",
    productId: "shirt",
    shopId: "123",
    createdAt: "2026-09-11T12:00:00Z",
    action: "update" as const,
    publishDetails: { images: true },
  }
  const job: PublishingJob = {
    event,
    state: "pending",
    attempts: 0,
    outcome: null,
    sourceFingerprint: null,
    callbackAttempted: false,
    failureCode: null,
  }
  const previous = { id: "shirt", title: "Published version", images: [{ src: "previous.jpg" }] }
  const candidate = { id: "shirt", title: "New version", images: [{ src: "source.jpg", variant_ids: [1] }] }
  const hosted = { ...candidate, images: [{ src: "hosted.jpg", variant_ids: [1] }] }
  const live = { ...candidate, is_locked: true }
  let published: Record<string, unknown> | null = firstPublication ? null : previous
  const record: PublishingRecord = {
    getJob: vi.fn(async () => job),
    isCurrent: vi.fn(async () => "current" as const),
    getProduct: vi.fn(async () => published),
    imageUploads: { read: vi.fn(async () => null), save: vi.fn(async () => undefined) },
    deferImages: vi.fn(async () => undefined),
    getImageBackfill: vi.fn(async () => null),
    replaceProductImages: vi.fn(async () => false),
    replaceProductArtwork: vi.fn(async () => false),
    activate: vi.fn(async (_event, snapshot, fingerprint) => {
      published = snapshot
      job.state = "callback"
      job.outcome = snapshot === null ? "unpublished" : "published"
      job.sourceFingerprint = fingerprint
      return true
    }),
    fail: vi.fn(async (_event, code, fingerprint) => {
      job.state = "callback"
      job.outcome = "failed"
      job.failureCode = code
      job.sourceFingerprint = fingerprint
      return true
    }),
    finish: vi.fn(async (_id, state, code) => {
      job.state = state
      job.failureCode = code ?? job.failureCode
    }),
    retry: vi.fn(async (_id, code) => {
      job.attempts++
      job.failureCode = code
    }),
    startCallback: vi.fn(async () => {
      job.callbackAttempted = true
      return true
    }),
    rejectCallback: vi.fn(async () => {
      job.callbackAttempted = false
    }),
  }
  const store: PublishingStore = {
    enqueue: vi.fn(async () => undefined),
    listPending: vi.fn(async () => [{ eventId: event.id, productId: event.productId }]),
    withProductLock: async (_id, callback) => callback(record),
    readProduct: vi.fn(async () => published),
    listProducts: vi.fn(async () => (published ? [published] : [])),
  }
  vi.mocked(mergePublishedProduct).mockReturnValue(candidate)
  vi.mocked(publishingSourceFingerprint).mockReturnValue("original-provider-fingerprint")
  const services = {
    store,
    client: { request: vi.fn(async (_id: string, action?: string) => (action ? null : live)) },
    siteUrl: "https://example.com",
    invalidate: vi.fn(),
    hostImages: vi.fn(async () => ({ snapshot: hosted, complete: true })),
  }
  return { event, job, record, services, previous, candidate, hosted, live }
}

describe("published image lifecycle", () => {
  it("activates complete hosted images while acknowledging the original provider fingerprint", async () => {
    const fixture = setup()
    await processPublishingJobs(fixture.services)
    expect(fixture.services.hostImages).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: fixture.candidate,
        revisionKey: "123:shirt:image-publication:original-provider-fingerprint",
        uploads: fixture.record.imageUploads,
      })
    )
    expect(fixture.record.activate).toHaveBeenCalledWith(fixture.event, fixture.hosted, "original-provider-fingerprint")
    expect(publishingSourceFingerprint).toHaveBeenLastCalledWith(
      fixture.live,
      { productId: "shirt", shopId: "123" },
      false
    )
    expect(fixture.services.client.request).toHaveBeenLastCalledWith(
      "shirt",
      "publishing_succeeded",
      expect.any(Object)
    )
    expect(fixture.job.state).toBe("complete")
  })

  it("defers an incomplete batch without changing the product or acknowledging it", async () => {
    const fixture = setup()
    fixture.services.hostImages.mockResolvedValue({ snapshot: fixture.hosted, complete: false })
    await processPublishingJobs(fixture.services)
    expect(fixture.record.deferImages).toHaveBeenCalledWith(fixture.event.id)
    expect(fixture.record.activate).not.toHaveBeenCalled()
    expect(fixture.record.fail).not.toHaveBeenCalled()
    expect(fixture.record.retry).not.toHaveBeenCalled()
    expect(await fixture.record.getProduct()).toEqual(fixture.previous)
    expect(fixture.services.client.request).toHaveBeenCalledTimes(1)
    fixture.services.hostImages.mockResolvedValue({ snapshot: fixture.hosted, complete: true })
    await processPublishingJobs(fixture.services)
    expect(fixture.record.activate).toHaveBeenCalledTimes(1)
  })

  it("retries temporary copy failures with a safe image-specific diagnostic", async () => {
    const fixture = setup()
    fixture.services.hostImages.mockRejectedValue(new PublishedImageError("IMAGE_STORAGE_UNAVAILABLE", true))
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    await processPublishingJobs(fixture.services)
    expect(fixture.record.retry).toHaveBeenCalledWith(fixture.event.id, "IMAGE_STORAGE_UNAVAILABLE", undefined)
    expect(fixture.record.activate).not.toHaveBeenCalled()
    expect(fixture.record.fail).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.any(String), {
      eventId: fixture.event.id,
      code: "IMAGE_STORAGE_UNAVAILABLE",
    })
  })

  it("reports a permanent image failure to Printify while preserving the previous snapshot", async () => {
    const fixture = setup()
    fixture.services.hostImages.mockRejectedValue(new PublishedImageError("IMAGE_CONTENT_INVALID", false))
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    await processPublishingJobs(fixture.services)
    expect(fixture.record.fail).toHaveBeenCalledWith(
      fixture.event,
      "IMAGE_CONTENT_INVALID",
      "original-provider-fingerprint"
    )
    expect(fixture.services.client.request).toHaveBeenLastCalledWith("shirt", "publishing_failed", expect.any(Object))
    expect(await fixture.record.getProduct()).toEqual(fixture.previous)
    expect(fixture.record.activate).not.toHaveBeenCalled()
  })

  it.each([
    ["IMAGE_STORAGE_CONFIGURATION", false],
    ["IMAGE_STORAGE_CONFIGURATION", true],
    ["IMAGE_SOURCE_CHANGED", false],
    ["IMAGE_STORAGE_CONFLICT", false],
  ] as const)("keeps %s for operator attention without a merchant failure callback", async (code, retryable) => {
    const fixture = setup()
    fixture.services.hostImages.mockRejectedValue(new PublishedImageError(code, retryable))
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined)
    await processPublishingJobs(fixture.services)
    expect(fixture.record.finish).toHaveBeenCalledWith(fixture.event.id, "attention", code)
    expect(fixture.record.activate).not.toHaveBeenCalled()
    expect(fixture.record.fail).not.toHaveBeenCalled()
    expect(fixture.record.retry).not.toHaveBeenCalled()
    expect(fixture.services.invalidate).not.toHaveBeenCalled()
    expect(fixture.services.client.request).toHaveBeenCalledTimes(1)
    expect(fixture.record.startCallback).not.toHaveBeenCalled()
    expect(await fixture.record.getProduct()).toEqual(fixture.previous)
    expect(fixture.job).toMatchObject({
      state: "attention",
      failureCode: code,
      outcome: null,
      callbackAttempted: false,
    })
    expect(error).toHaveBeenCalledWith("Published product image storage needs attention", {
      eventId: fixture.event.id,
      code,
    })
    await processPublishingJobs(fixture.services)
    expect(fixture.services.client.request).toHaveBeenCalledTimes(1)
  })

  it("supersedes an older job when storage configuration fails after newer intake", async () => {
    const fixture = setup()
    fixture.services.hostImages.mockRejectedValue(new PublishedImageError("IMAGE_STORAGE_CONFIGURATION", false))
    vi.mocked(fixture.record.isCurrent).mockResolvedValueOnce("current").mockResolvedValue("superseded")
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    await processPublishingJobs(fixture.services)
    expect(fixture.record.finish).toHaveBeenCalledWith(fixture.event.id, "superseded", undefined)
    expect(fixture.record.fail).not.toHaveBeenCalled()
    expect(await fixture.record.getProduct()).toEqual(fixture.previous)
  })

  it("rechecks event ordering after uploads before activating", async () => {
    const fixture = setup()
    vi.mocked(fixture.record.isCurrent).mockResolvedValueOnce("current").mockResolvedValue("superseded")
    await processPublishingJobs(fixture.services)
    expect(fixture.services.hostImages).toHaveBeenCalled()
    expect(fixture.record.activate).not.toHaveBeenCalled()
    expect(fixture.record.finish).toHaveBeenCalledWith(fixture.event.id, "superseded", undefined)
  })

  it.each(["title-only", "visibility", "delete", "callback"])("does not copy images during %s work", async (kind) => {
    const fixture = setup()
    if (kind === "title-only") fixture.event.publishDetails = { title: true, images: false }
    if (kind === "visibility") fixture.event.publishDetails = { images: false }
    if (kind === "delete") Object.assign(fixture.event, { action: "delete" })
    if (kind === "callback") {
      fixture.job.state = "callback"
      fixture.job.outcome = "published"
      fixture.job.sourceFingerprint = "original-provider-fingerprint"
    }
    await processPublishingJobs(fixture.services)
    expect(fixture.services.hostImages).not.toHaveBeenCalled()
  })
})

describe("published artwork lifecycle", () => {
  const pinned = {
    src: "https://catalog.public.blob.vercel-storage.com/published-artwork/v1/preview.webp",
    revisionId: "approved-revision",
    productionFingerprint: "artwork-v1:approved",
    width: 960,
    height: 1200,
  }

  it("activates the exact artwork snapshot and marks its revision only after provider acknowledgment", async () => {
    const fixture = setup()
    const snapshot = { ...fixture.hosted, storefront_artwork: pinned, storefront_artwork_enabled: true }
    const hostArtwork = vi.fn(async () => ({ snapshot, complete: true }))
    const markArtworkPublished = vi.fn(async () => true)
    await processPublishingJobs({ ...fixture.services, hostArtwork, markArtworkPublished })
    expect(hostArtwork).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        snapshot: fixture.hosted,
        source: fixture.live,
        expected: { shopId: "123", productId: "shirt" },
        uploads: fixture.record.imageUploads,
      })
    )
    expect(fixture.record.activate).toHaveBeenCalledWith(fixture.event, snapshot, "original-provider-fingerprint")
    expect(markArtworkPublished).toHaveBeenCalledExactlyOnceWith({
      shopId: "123",
      productId: "shirt",
      revisionId: pinned.revisionId,
      productionFingerprint: pinned.productionFingerprint,
      storefrontUrl: "https://example.com/shop/shirt",
    })
    expect(markArtworkPublished.mock.invocationCallOrder[0]).toBeGreaterThan(
      fixture.services.client.request.mock.invocationCallOrder.at(-1)!
    )
    expect(await fixture.record.getProduct()).toEqual(snapshot)
    expect(fixture.services.client.request.mock.calls.filter((call) => call[1])).toEqual([
      ["shirt", "publishing_succeeded", { external: { id: "shirt", handle: "https://example.com/shop/shirt" } }],
    ])
    expect(fixture.record.fail).not.toHaveBeenCalled()
    expect(fixture.job).toMatchObject({ state: "complete", outcome: "published" })
  })

  it.each([
    { kind: "first publication", firstPublication: true },
    { kind: "replacement publication", firstPublication: false },
  ])(
    "fails a $kind with unresolved artwork without changing its published product or provider source",
    async ({ firstPublication }) => {
      const fixture = setup({ firstPublication })
      Object.assign(fixture.previous, {
        variants: [{ id: 1, price: 2400, is_enabled: true }],
        print_areas: [
          { variant_ids: [1], placeholders: [{ position: "front", images: [{ id: "published-upload" }] }] },
        ],
        storefront_artwork: pinned,
        storefront_artwork_enabled: true,
      })
      Object.assign(fixture.live, {
        variants: [{ id: 1, price: 2600, is_enabled: true }],
        print_areas: [
          { variant_ids: [1], placeholders: [{ position: "front", images: [{ id: "unmatched-upload" }] }] },
        ],
      })
      const publishedBefore = structuredClone(await fixture.record.getProduct())
      const providerBefore = structuredClone(fixture.live)
      const hostArtwork = vi.fn(async () => {
        throw new PublishedImageError("ARTWORK_NOT_RESOLVED", false)
      })
      const markArtworkPublished = vi.fn()
      const markArtworkUnverified = vi.fn()
      const markArtworkRemoved = vi.fn()
      const services = {
        ...fixture.services,
        hostArtwork,
        markArtworkPublished,
        markArtworkUnverified,
        markArtworkRemoved,
      }
      vi.spyOn(console, "error").mockImplementation(() => undefined)

      await processPublishingJobs(services)
      await processPublishingJobs(services)

      expect(hostArtwork).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ snapshot: fixture.hosted, source: fixture.live })
      )
      expect(fixture.record.fail).toHaveBeenCalledExactlyOnceWith(
        fixture.event,
        "ARTWORK_NOT_RESOLVED",
        "original-provider-fingerprint"
      )
      expect(fixture.services.client.request.mock.calls.filter((call) => call[1])).toEqual([
        [
          "shirt",
          "publishing_failed",
          {
            reason:
              "The website could not verify this product's artwork preview. Any previous listing is unchanged. Ask your store agent to reconnect the exact artwork, then publish images again.",
          },
        ],
      ])
      expect(fixture.record.finish).toHaveBeenCalledExactlyOnceWith(fixture.event.id, "complete")
      expect(fixture.job).toMatchObject({ state: "complete", outcome: "failed", failureCode: "ARTWORK_NOT_RESOLVED" })
      expect(fixture.record.activate).not.toHaveBeenCalled()
      expect(fixture.record.replaceProductImages).not.toHaveBeenCalled()
      expect(fixture.record.replaceProductArtwork).not.toHaveBeenCalled()
      expect(fixture.record.retry).not.toHaveBeenCalled()
      expect(fixture.record.deferImages).not.toHaveBeenCalled()
      expect(fixture.services.invalidate).not.toHaveBeenCalled()
      expect(markArtworkPublished).not.toHaveBeenCalled()
      expect(markArtworkUnverified).not.toHaveBeenCalled()
      expect(markArtworkRemoved).not.toHaveBeenCalled()
      expect(await fixture.record.getProduct()).toEqual(publishedBefore)
      expect(fixture.live).toEqual(providerBefore)
    }
  )

  it.each(["not-sent", "rate-limited"] as const)(
    "preserves the artwork failure reason through a %s callback retry and completion",
    async (delivery) => {
      const fixture = setup()
      const hostArtwork = vi.fn(async () => {
        throw new PublishedImageError("ARTWORK_NOT_RESOLVED", false)
      })
      let callbackAttempts = 0
      fixture.services.client.request.mockImplementation(async (_id, action) => {
        if (!action) return fixture.live
        if (++callbackAttempts === 1) throw new PrintifyRequestError(delivery, 120)
        return null
      })
      vi.spyOn(console, "error").mockImplementation(() => undefined)
      vi.spyOn(console, "warn").mockImplementation(() => undefined)
      const services = { ...fixture.services, hostArtwork }

      await processPublishingJobs(services)
      expect(fixture.record.retry).toHaveBeenCalledExactlyOnceWith(fixture.event.id, "ARTWORK_NOT_RESOLVED", 120)
      expect(fixture.job).toMatchObject({
        state: "callback",
        outcome: "failed",
        attempts: 1,
        failureCode: "ARTWORK_NOT_RESOLVED",
        callbackAttempted: false,
      })

      await processPublishingJobs(services)
      await processPublishingJobs(services)
      const failure = [
        "shirt",
        "publishing_failed",
        {
          reason:
            "The website could not verify this product's artwork preview. Any previous listing is unchanged. Ask your store agent to reconnect the exact artwork, then publish images again.",
        },
      ]
      expect(fixture.services.client.request.mock.calls.filter((call) => call[1])).toEqual([failure, failure])
      expect(fixture.job).toMatchObject({ state: "complete", outcome: "failed", failureCode: "ARTWORK_NOT_RESOLVED" })
      expect(fixture.record.finish).toHaveBeenCalledExactlyOnceWith(fixture.event.id, "complete")
      expect(fixture.record.rejectCallback).toHaveBeenCalledExactlyOnceWith(fixture.event.id)
      expect(fixture.record.fail).toHaveBeenCalledTimes(1)
      expect(hostArtwork).toHaveBeenCalledTimes(1)
      expect(fixture.record.activate).not.toHaveBeenCalled()
      expect(fixture.services.invalidate).not.toHaveBeenCalled()
      expect(await fixture.record.getProduct()).toEqual(fixture.previous)
    }
  )

  it("does not resend an uncertain failed-artwork callback into a still-locked product", async () => {
    const fixture = setup()
    const hostArtwork = vi.fn(async () => {
      throw new PublishedImageError("ARTWORK_NOT_RESOLVED", false)
    })
    fixture.services.client.request.mockImplementation(async (_id, action) => {
      if (action) throw new PrintifyRequestError("uncertain")
      return fixture.live
    })
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const services = { ...fixture.services, hostArtwork }

    await processPublishingJobs(services)
    expect(fixture.job).toMatchObject({
      state: "callback",
      outcome: "failed",
      failureCode: "ARTWORK_NOT_RESOLVED",
      callbackAttempted: true,
    })
    await processPublishingJobs(services)
    expect(fixture.services.client.request.mock.calls.filter((call) => call[1])).toHaveLength(1)
    expect(fixture.record.rejectCallback).not.toHaveBeenCalled()
    expect(fixture.job).toMatchObject({ state: "attention", failureCode: "CALLBACK_STATE_UNCERTAIN" })
    expect(fixture.record.activate).not.toHaveBeenCalled()
    expect(await fixture.record.getProduct()).toEqual(fixture.previous)
  })

  it("defers unfinished artwork without activating or acknowledging the pending revision", async () => {
    const fixture = setup()
    const hostArtwork = vi.fn(async () => ({ snapshot: fixture.hosted, complete: false }))
    const markArtworkPublished = vi.fn()
    await processPublishingJobs({ ...fixture.services, hostArtwork, markArtworkPublished })
    expect(fixture.record.deferImages).toHaveBeenCalledWith(fixture.event.id)
    expect(fixture.record.activate).not.toHaveBeenCalled()
    expect(markArtworkPublished).not.toHaveBeenCalled()
    expect(fixture.services.client.request).toHaveBeenCalledOnce()
    expect(await fixture.record.getProduct()).toEqual(fixture.previous)
  })

  it("requires operator attention for an unmatched artwork source without acknowledging or changing the prior snapshot", async () => {
    const fixture = setup()
    const hostArtwork = vi.fn(async () => {
      throw new PublishedImageError("IMAGE_SOURCE_CHANGED", false)
    })
    const markArtworkPublished = vi.fn()
    await processPublishingJobs({ ...fixture.services, hostArtwork, markArtworkPublished })
    expect(fixture.record.finish).toHaveBeenCalledWith(fixture.event.id, "attention", "IMAGE_SOURCE_CHANGED")
    expect(fixture.record.activate).not.toHaveBeenCalled()
    expect(fixture.record.startCallback).not.toHaveBeenCalled()
    expect(markArtworkPublished).not.toHaveBeenCalled()
    expect(await fixture.record.getProduct()).toEqual(fixture.previous)
  })

  it("recovers a failed badge update from confirmed provider state without repeating its acknowledgment", async () => {
    const fixture = setup()
    const snapshot = { ...fixture.hosted, storefront_artwork: pinned }
    const hostArtwork = vi.fn(async () => ({ snapshot, complete: true }))
    const markArtworkPublished = vi
      .fn()
      .mockRejectedValueOnce(new Error("database interrupted"))
      .mockResolvedValue(true)
    fixture.services.client.request.mockImplementation(async (_id, action) => {
      if (action) fixture.job.callbackAttempted = true
      return action
        ? null
        : fixture.job.callbackAttempted
          ? { ...fixture.live, is_locked: false, external: { id: "shirt", handle: "https://example.com/shop/shirt" } }
          : fixture.live
    })
    await processPublishingJobs({ ...fixture.services, hostArtwork, markArtworkPublished })
    expect(fixture.record.retry).toHaveBeenCalledWith(fixture.event.id, "CALLBACK_RETRY", undefined)
    expect(fixture.job.state).toBe("callback")
    await processPublishingJobs({ ...fixture.services, hostArtwork, markArtworkPublished })
    expect(markArtworkPublished).toHaveBeenCalledTimes(2)
    expect(
      fixture.services.client.request.mock.calls.filter((call) => call[1] === "publishing_succeeded")
    ).toHaveLength(1)
    expect(fixture.job.state).toBe("complete")
  })

  it("does not regenerate artwork for a metadata-only publication", async () => {
    const fixture = setup()
    fixture.event.publishDetails = { title: true }
    const hostArtwork = vi.fn()
    await processPublishingJobs({ ...fixture.services, hostArtwork })
    expect(hostArtwork).not.toHaveBeenCalled()
  })

  it("demotes stale In store claims after publishing an unmapped revision", async () => {
    const fixture = setup()
    const markArtworkUnverified = vi.fn(async () => true)
    const markArtworkPublished = vi.fn(async () => true)
    await processPublishingJobs({ ...fixture.services, markArtworkUnverified, markArtworkPublished })
    expect(markArtworkUnverified).toHaveBeenCalledExactlyOnceWith({ shopId: "123", productId: "shirt" })
    expect(markArtworkPublished).not.toHaveBeenCalled()
    expect(fixture.job.state).toBe("complete")
  })

  it("clears In store state after a confirmed Hide while retaining its pinned snapshot", async () => {
    const fixture = setup()
    const snapshot = { ...fixture.candidate, visible: false, storefront_artwork: pinned }
    vi.mocked(mergePublishedProduct).mockReturnValue(snapshot)
    fixture.event.publishDetails = { images: false }
    const markArtworkRemoved = vi.fn(async () => true)
    await processPublishingJobs({ ...fixture.services, markArtworkRemoved })
    expect(markArtworkRemoved).toHaveBeenCalledExactlyOnceWith({ shopId: "123", productId: "shirt" })
    expect(await fixture.record.getProduct()).toEqual(snapshot)
    expect(fixture.job.state).toBe("complete")
  })

  it("marks an acknowledged removed product without discarding its library history", async () => {
    const fixture = setup()
    fixture.event.action = "delete"
    fixture.services.client.request.mockResolvedValue(null)
    const markArtworkRemoved = vi.fn(async () => true)
    await processPublishingJobs({ ...fixture.services, markArtworkRemoved })
    expect(markArtworkRemoved).toHaveBeenCalledExactlyOnceWith({ shopId: "123", productId: "shirt" })
    expect(fixture.job.state).toBe("complete")
    expect(fixture.services.client.request.mock.calls.every((call) => !call[1])).toBe(true)
  })
})
