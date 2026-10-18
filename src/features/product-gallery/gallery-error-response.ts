import { privateResponseHeaders } from "@/lib/private-response-headers"
import { GalleryError } from "./gallery-error"
import { logGalleryFailure } from "./log-gallery-failure.server"
export function galleryErrorResponse(error: unknown) {
  logGalleryFailure(error)
  return Response.json(
    {
      error:
        error instanceof GalleryError
          ? error.message
          : "We couldn’t confirm the saved state. Reload before retrying. Check gallery database and image storage configuration if this continues.",
    },
    { status: error instanceof GalleryError ? error.status : 503, headers: privateResponseHeaders }
  )
}
