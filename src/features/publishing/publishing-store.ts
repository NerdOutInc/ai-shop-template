import type { PublishingEvent } from "./publishing-event"
import type { PublishedArtwork } from "./published-artwork-schema"

export type PublishingJob = {
  event: PublishingEvent
  state: "pending" | "callback" | "complete" | "superseded" | "attention"
  attempts: number
  outcome: "published" | "unpublished" | "failed" | null
  sourceFingerprint: string | null
  callbackAttempted: boolean
  failureCode: string | null
}

export type PublishingRecord = {
  imageUploads: {
    read: (key: string) => Promise<string | null>
    save: (key: string, url: string) => Promise<void>
  }
  getJob: (eventId: string) => Promise<PublishingJob | null>
  isCurrent: (event: PublishingEvent) => Promise<"current" | "superseded" | "ambiguous">
  getProduct: () => Promise<Record<string, unknown> | null>
  getImageBackfill: () => Promise<{ revision: string; snapshot: Record<string, unknown> } | null>
  replaceProductImages: (expectedRevision: string, images: unknown[]) => Promise<boolean>
  replaceProductArtwork: (expectedRevision: string, artwork: PublishedArtwork) => Promise<boolean>
  activate: (
    event: PublishingEvent,
    snapshot: Record<string, unknown> | null,
    sourceFingerprint: string | null
  ) => Promise<boolean>
  fail: (event: PublishingEvent, failureCode: string, sourceFingerprint: string | null) => Promise<boolean>
  finish: (eventId: string, state: "complete" | "superseded" | "attention", failureCode?: string) => Promise<void>
  retry: (eventId: string, failureCode: string, retryAfterSeconds?: number) => Promise<void>
  deferImages: (eventId: string) => Promise<void>
  startCallback: (event: PublishingEvent) => Promise<boolean>
  rejectCallback: (eventId: string) => Promise<void>
}

export type PublishingStore = {
  enqueue: (event: PublishingEvent) => Promise<void>
  listPending: (limit: number) => Promise<{ eventId: string; productId: string }[]>
  withProductLock: <T>(productId: string, callback: (record: PublishingRecord) => Promise<T>) => Promise<T | null>
  readProduct: (productId: string) => Promise<Record<string, unknown> | null>
  listProducts: () => Promise<Record<string, unknown>[]>
}
