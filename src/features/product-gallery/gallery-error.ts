export class GalleryError extends Error {
  constructor(
    message: string,
    readonly status = 409,
    readonly code:
      | "GALLERY_REQUEST_REJECTED"
      | "PHOTO_MISSING"
      | "PHOTO_CHANGED"
      | "PHOTO_OWNERSHIP"
      | "PHOTO_STORAGE_CONFLICT"
      | "PHOTO_STORAGE_CONFIGURATION" = "GALLERY_REQUEST_REJECTED"
  ) {
    super(message)
  }
}
