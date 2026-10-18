import { BlobAccessError, BlobStoreNotFoundError, BlobStoreSuspendedError } from "@vercel/blob"
import { PublishedImageError } from "./published-image-error"

export function classifyImageStorageError(error: unknown) {
  if (error instanceof PublishedImageError) return error
  const configuration =
    error instanceof BlobAccessError ||
    error instanceof BlobStoreNotFoundError ||
    error instanceof BlobStoreSuspendedError
  return new PublishedImageError(
    configuration ? "IMAGE_STORAGE_CONFIGURATION" : "IMAGE_STORAGE_UNAVAILABLE",
    !configuration
  )
}
