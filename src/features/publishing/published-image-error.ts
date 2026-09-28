export class PublishedImageError extends Error {
  constructor(
    readonly code:
      | "ARTWORK_NOT_RESOLVED"
      | "IMAGE_SOURCE_INVALID"
      | "IMAGE_SOURCE_CHANGED"
      | "IMAGE_CONTENT_INVALID"
      | "IMAGE_DERIVATION_TIMEOUT"
      | "IMAGE_SOURCE_UNAVAILABLE"
      | "IMAGE_STORAGE_UNAVAILABLE"
      | "IMAGE_STORAGE_CONFLICT"
      | "IMAGE_STORAGE_CONFIGURATION"
      | "IMAGE_RECEIPT_UNAVAILABLE",
    readonly retryable: boolean
  ) {
    super(code)
    this.name = "PublishedImageError"
  }
}
