import {
  BlobAccessError,
  BlobNotFoundError,
  BlobServiceNotAvailable,
  BlobStoreNotFoundError,
  BlobStoreSuspendedError,
} from "@vercel/blob"
import { describe, expect, it } from "vitest"

import { classifyImageStorageError } from "./classify-image-storage-error"
import { PublishedImageError } from "./published-image-error"

describe("image storage error classification", () => {
  it.each([
    ["access", new BlobAccessError()],
    ["missing store", new BlobStoreNotFoundError()],
    ["suspended store", new BlobStoreSuspendedError()],
  ])("treats a %s error as non-retryable configuration", (_name, error) => {
    expect(classifyImageStorageError(error)).toMatchObject({ code: "IMAGE_STORAGE_CONFIGURATION", retryable: false })
  })

  it.each([
    ["missing object", new BlobNotFoundError()],
    ["service outage", new BlobServiceNotAvailable()],
    ["network failure", new TypeError("fetch failed")],
    ["unknown value", "unexpected"],
  ])("keeps a %s retryable", (_name, error) => {
    expect(classifyImageStorageError(error)).toMatchObject({ code: "IMAGE_STORAGE_UNAVAILABLE", retryable: true })
  })

  it("preserves an existing published-image error", () => {
    const error = new PublishedImageError("IMAGE_STORAGE_CONFLICT", false)

    expect(classifyImageStorageError(error)).toBe(error)
  })
})
