import { z } from "zod"
import { matchesEntityTag } from "@/lib/matches-entity-tag"
import { privateResponseHeaders } from "@/lib/private-response-headers"
import { authorizeGalleryAdmin } from "@/features/product-gallery/authorize-gallery-admin.server"
import { getProductGalleryStore } from "@/features/product-gallery/get-product-gallery-store.server"
import { readGalleryPhoto } from "@/features/product-gallery/read-gallery-photo.server"
import { galleryErrorResponse } from "@/features/product-gallery/gallery-error-response"
import { GalleryError } from "@/features/product-gallery/gallery-error"
export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export async function GET(request: Request, context: { params: Promise<{ product: string; asset: string }> }) {
  try {
    const { product, asset } = await context.params
    await authorizeGalleryAdmin(request, product)
    if (!z.uuid().safeParse(asset).success) throw new GalleryError("Photo not found.", 404)
    const record = await getProductGalleryStore().asset(product, asset)
    if (!record) throw new GalleryError("Photo not found.", 404)
    // Revalidate membership and product ownership even when the browser already has these bytes.
    // The admin proxy leaves this one GET route out of its blanket no-store so the ETag can work.
    const headers = { ...privateResponseHeaders, "Cache-Control": "private, no-cache", ETag: `"${record.sha256}"` }
    if (matchesEntityTag(request.headers.get("if-none-match"), headers.ETag))
      return new Response(null, { status: 304, headers })
    const bytes = await readGalleryPhoto(record)
    return new Response(new Uint8Array(bytes), {
      headers: { ...headers, "Content-Type": "image/jpeg", "Content-Length": String(bytes.length) },
    })
  } catch (error) {
    return galleryErrorResponse(error)
  }
}
