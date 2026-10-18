import { privateResponseHeaders } from "@/lib/private-response-headers"
import { authorizeGalleryAdmin } from "@/features/product-gallery/authorize-gallery-admin.server"
import { uploadGalleryPhoto } from "@/features/product-gallery/upload-gallery-photo.server"
import { galleryErrorResponse } from "@/features/product-gallery/gallery-error-response"
export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 30
export async function POST(request: Request, context: { params: Promise<{ product: string }> }) {
  try {
    const { product } = await context.params,
      actor = await authorizeGalleryAdmin(request, product)
    return Response.json(await uploadGalleryPhoto(request, product, actor.userId), { headers: privateResponseHeaders })
  } catch (error) {
    return galleryErrorResponse(error)
  }
}
