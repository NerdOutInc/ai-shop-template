import "server-only"
import { BlobAccessError, BlobStoreNotFoundError, BlobStoreSuspendedError } from "@vercel/blob"
import { ZodError } from "zod"
import { PublishedImageError } from "@/features/publishing/published-image-error"
import { GalleryError } from "./gallery-error"

export function logGalleryFailure(error: unknown) {
  if (error instanceof GalleryError && error.status < 500 && error.code === "GALLERY_REQUEST_REJECTED") return
  const databaseCodes: Record<string, string> = {
    "42P01": "GALLERY_SCHEMA_MISSING",
    "42501": "GALLERY_DATABASE_PERMISSION",
    "55P03": "GALLERY_DATABASE_LOCK_TIMEOUT",
    "57014": "GALLERY_DATABASE_TIMEOUT",
  }
  const databaseCode =
    error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? Object.hasOwn(databaseCodes, error.code)
        ? databaseCodes[error.code]
        : undefined
      : undefined
  const code =
    error instanceof GalleryError
      ? error.code
      : error instanceof PublishedImageError
        ? error.code
        : (databaseCode ??
          (error instanceof BlobAccessError ||
          error instanceof BlobStoreNotFoundError ||
          error instanceof BlobStoreSuspendedError
            ? "PHOTO_STORAGE_CONFIGURATION"
            : error instanceof ZodError
              ? "GALLERY_SOURCE_INVALID"
              : "GALLERY_OUTCOME_UNKNOWN"))
  // Never log request bodies, database messages, Blob paths, tokens, or private photo descriptions.
  console.error("Product gallery operation failed", { code })
}
