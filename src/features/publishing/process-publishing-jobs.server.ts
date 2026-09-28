import "server-only"

import { observePublishedStock } from "@/features/catalog-sync/observe-published-stock.server"

import type { HostPublishedArtworkOptions } from "./host-published-artwork.server"
import { mergePublishedProduct } from "./merge-published-product"
import { isVisibilityOnlyEvent } from "./is-visibility-only-event"
import type { PrintifyPublishingClient } from "./printify-publishing-client.server"
import { PrintifyRequestError } from "./printify-request-error"
import { PublishedImageError } from "./published-image-error"
import { publishingSourceFingerprint } from "./publishing-source-fingerprint"
import type { PublishingJob, PublishingRecord, PublishingStore } from "./publishing-store"

type Services = {
  store: PublishingStore
  client: Pick<PrintifyPublishingClient, "request">
  siteUrl: string
  invalidate: () => void
  hostArtwork?: (
    input: Pick<
      HostPublishedArtworkOptions,
      "snapshot" | "source" | "expected" | "revisionKey" | "uploads" | "deadline"
    >
  ) => Promise<{ snapshot: Record<string, unknown>; complete: boolean }>
  markArtworkUnverified?: (input: { shopId: string; productId: string }) => Promise<unknown>
  markArtworkRemoved?: (input: { shopId: string; productId: string }) => Promise<unknown>
  markArtworkPublished?: (input: {
    shopId: string
    productId: string
    revisionId: string
    productionFingerprint: string
    storefrontUrl: string
  }) => Promise<unknown>
  hostImages: (input: {
    snapshot: Record<string, unknown>
    revisionKey: string
    uploads: PublishingRecord["imageUploads"]
    deadline: number
  }) => Promise<{ snapshot: Record<string, unknown>; complete: boolean }>
}

function sameHandle(received: unknown, expected: string) {
  if (typeof received !== "string") return false
  try {
    const actual = new URL(received)
    const target = new URL(expected)
    return (
      !actual.username &&
      !actual.password &&
      actual.origin === target.origin &&
      actual.pathname.replace(/\/$/, "") === target.pathname.replace(/\/$/, "") &&
      actual.search === target.search &&
      actual.hash === target.hash
    )
  } catch {
    return false
  }
}

async function ensureCurrent(record: PublishingRecord, job: PublishingJob) {
  const current = await record.isCurrent(job.event)
  if (current === "current") return true
  await record.finish(
    job.event.id,
    current === "superseded" ? "superseded" : "attention",
    current === "ambiguous" ? "EVENT_ORDER_AMBIGUOUS" : undefined
  )
  return false
}

async function recordArtworkOutcome(services: Services, record: PublishingRecord, job: PublishingJob) {
  if (
    job.outcome === "failed" ||
    (!services.markArtworkPublished && !services.markArtworkRemoved && !services.markArtworkUnverified)
  )
    return
  const snapshot = job.outcome === "published" ? await record.getProduct() : null
  if (job.outcome === "unpublished" || snapshot?.visible === false) {
    await services.markArtworkRemoved?.({ shopId: job.event.shopId, productId: job.event.productId })
    return
  }
  if (job.outcome !== "published") return
  const artwork = snapshot?.storefront_artwork
  if (
    !artwork ||
    typeof artwork !== "object" ||
    !("revisionId" in artwork) ||
    !("productionFingerprint" in artwork) ||
    typeof artwork.revisionId !== "string" ||
    typeof artwork.productionFingerprint !== "string"
  ) {
    await services.markArtworkUnverified?.({ shopId: job.event.shopId, productId: job.event.productId })
    return
  }
  await services.markArtworkPublished?.({
    shopId: job.event.shopId,
    productId: job.event.productId,
    revisionId: artwork.revisionId,
    productionFingerprint: artwork.productionFingerprint,
    storefrontUrl: `${services.siteUrl}/shop/${encodeURIComponent(job.event.productId)}`,
  })
}

async function acknowledge(services: Services, record: PublishingRecord, job: PublishingJob) {
  if (!(await ensureCurrent(record, job))) return
  const { productId, shopId } = job.event
  const live = await services.client.request(productId)
  const external = { id: productId, handle: `${services.siteUrl}/shop/${encodeURIComponent(productId)}` }
  if (!live) {
    // Delete can remove the API resource before its notification arrives.
    if (job.outcome === "unpublished") await recordArtworkOutcome(services, record, job)
    await record.finish(job.event.id, job.outcome === "unpublished" ? "complete" : "attention", "SOURCE_DELETED")
    return
  }
  if (live.is_locked === false) {
    const linked = live.external as { id?: unknown; handle?: unknown } | undefined
    const saved = job.outcome === "published" ? await record.getProduct() : null
    const visibilityMatches =
      saved !== null &&
      (typeof live.visible === "boolean" ||
        (live.visible === undefined && !job.sourceFingerprint?.startsWith("visibility-v1:"))) &&
      (saved.visible !== false) === (live.visible !== false)
    const confirmed =
      job.outcome === "failed" ||
      (job.outcome === "unpublished" && live.visible === false) ||
      (job.outcome === "published" &&
        visibilityMatches &&
        linked?.id === external.id &&
        sameHandle(linked?.handle, external.handle))
    if (confirmed) await recordArtworkOutcome(services, record, job)
    await record.finish(
      job.event.id,
      confirmed ? "complete" : "attention",
      confirmed ? undefined : "CALLBACK_STATE_UNCERTAIN"
    )
    return
  }
  // Printify exposes no publication generation/idempotency key. After an uncertain POST,
  // an identical locked product might belong to a newer Publish whose webhook is delayed.
  if (job.callbackAttempted) {
    await record.finish(job.event.id, "attention", "CALLBACK_STATE_UNCERTAIN")
    return
  }
  if (
    live.is_locked !== true ||
    (job.outcome !== "unpublished" &&
      (!job.sourceFingerprint ||
        publishingSourceFingerprint(live, { productId, shopId }, job.sourceFingerprint.startsWith("visibility-v1:")) !==
          job.sourceFingerprint))
  ) {
    await record.finish(job.event.id, "attention", "SOURCE_CHANGED_BEFORE_CALLBACK")
    return
  }
  if (!(await record.startCallback(job.event))) return
  try {
    if (job.outcome === "published") await services.client.request(productId, "publishing_succeeded", { external })
    else if (job.outcome === "unpublished") await services.client.request(productId, "unpublish", {})
    else
      await services.client.request(productId, "publishing_failed", {
        reason:
          job.failureCode === "ARTWORK_NOT_RESOLVED"
            ? "The website could not verify this product's artwork preview. Any previous listing is unchanged. Ask your store agent to reconnect the exact artwork, then publish images again."
            : "The storefront could not publish this revision. Review its selected fields and mockups, then publish again.",
      })
  } catch (error) {
    if (error instanceof PrintifyRequestError && error.delivery !== "uncertain") {
      await record.rejectCallback(job.event.id)
      if (error.delivery === "rejected") {
        await record.finish(job.event.id, "attention", "CALLBACK_REJECTED")
        return
      }
    }
    throw error
  }
  await recordArtworkOutcome(services, record, job)
  await record.finish(job.event.id, "complete")
}

async function processJob(services: Services, record: PublishingRecord, eventId: string, imageDeadline: number) {
  let job = await record.getJob(eventId)
  if (!job || !["pending", "callback"].includes(job.state) || !(await ensureCurrent(record, job))) return
  try {
    if (job.state === "pending") {
      if (job.event.action === "delete") {
        // A signed removal must stop new sales even if Printify is down or the source is already gone.
        if (!(await record.activate(job.event, null, null))) return
      } else {
        const observedAt = Date.now()
        const live = await services.client.request(job.event.productId)
        if (!live || live.is_locked !== true) {
          await record.finish(eventId, "attention", live ? "SOURCE_NOT_LOCKED" : "SOURCE_DELETED")
          return
        }
        let snapshot: Record<string, unknown>
        let fingerprint: string | null = null
        const previous = await record.getProduct()
        try {
          fingerprint = publishingSourceFingerprint(live, job.event, isVisibilityOnlyEvent(job.event))
          snapshot = mergePublishedProduct(job.event, live, previous)
        } catch {
          if (!fingerprint) {
            await record.finish(eventId, "attention", "INVALID_SOURCE")
            return
          }
          if (!(await record.fail(job.event, "PUBLICATION_INVALID", fingerprint))) return
          job = (await record.getJob(eventId))!
          await acknowledge(services, record, job)
          return
        }
        if (!isVisibilityOnlyEvent(job.event) && job.event.publishDetails.images) {
          try {
            const hosted = await services.hostImages({
              snapshot,
              revisionKey: `${job.event.shopId}:${job.event.productId}:${eventId}:${fingerprint}`,
              uploads: record.imageUploads,
              deadline: imageDeadline,
            })
            if (!hosted.complete) {
              await record.deferImages(eventId)
              return
            }
            snapshot = hosted.snapshot
            if (services.hostArtwork) {
              const artwork = await services.hostArtwork({
                snapshot,
                source: live,
                expected: { shopId: job.event.shopId, productId: job.event.productId },
                revisionKey: `${job.event.shopId}:${job.event.productId}:${eventId}:${fingerprint}`,
                uploads: record.imageUploads,
                deadline: imageDeadline,
              })
              if (!artwork.complete) {
                await record.deferImages(eventId)
                return
              }
              snapshot = artwork.snapshot
            }
          } catch (error) {
            if (
              error instanceof PublishedImageError &&
              (error.code === "IMAGE_STORAGE_CONFIGURATION" ||
                error.code === "IMAGE_SOURCE_CHANGED" ||
                error.code === "IMAGE_STORAGE_CONFLICT")
            ) {
              console.error("Published product image storage needs attention", { eventId, code: error.code })
              if (await ensureCurrent(record, job)) await record.finish(eventId, "attention", error.code)
              return
            }
            if (!(error instanceof PublishedImageError) || error.retryable) throw error
            console.error("Published product images need review", { eventId, code: error.code })
            if (!(await record.fail(job.event, error.code, fingerprint))) return
            job = (await record.getJob(eventId))!
            await acknowledge(services, record, job)
            return
          }
        }
        if (!(await ensureCurrent(record, job))) return
        // Commit the already-read live stock with the revision, including Show and selective publications.
        snapshot.storefront_stock = observePublishedStock(live, job.event, observedAt)
        if (!(await record.activate(job.event, snapshot, fingerprint))) return
      }
      job = (await record.getJob(eventId))!
    }
    // Called again on retries after an interruption between commit and invalidation.
    if (job.outcome !== "failed") services.invalidate()
    await acknowledge(services, record, job)
  } catch (error) {
    // A committed publication never becomes a failed publication because its callback timed out.
    // Failed outcomes also retain their original reason for the next merchant acknowledgment.
    const latest = await record.getJob(eventId)
    if (latest && ["pending", "callback"].includes(latest.state)) {
      if (latest.attempts >= 7) await record.finish(eventId, "attention", "RETRIES_EXHAUSTED")
      else
        await record.retry(
          eventId,
          latest.state === "callback"
            ? latest.outcome === "failed"
              ? (latest.failureCode ?? "CALLBACK_RETRY")
              : "CALLBACK_RETRY"
            : error instanceof PublishedImageError
              ? error.code
              : "SOURCE_RETRY",
          error instanceof PrintifyRequestError ? error.retryAfterSeconds : undefined
        )
    }
    console.warn("Printify publishing needs retry or review", {
      eventId,
      ...(error instanceof PublishedImageError ? { code: error.code } : {}),
    })
  }
}

export async function processPublishingJobs(services: Services, limit = 1) {
  const started = Date.now()
  const jobs = await services.store.listPending(limit)
  let processed = 0
  for (const job of jobs) {
    // Image work stops at 30s, reserving two provider requests and database cleanup.
    if (Date.now() - started > 15_000) break
    await services.store.withProductLock(job.productId, async (record) => {
      await processJob(services, record, job.eventId, started + 30_000)
      processed++
    })
  }
  return { processed }
}
