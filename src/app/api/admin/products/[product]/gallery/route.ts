import { privateResponseHeaders } from "@/lib/private-response-headers"
import { env } from "@/lib/env"
import { authorizeGalleryAdmin } from "@/features/product-gallery/authorize-gallery-admin.server"
import { readGalleryEditor } from "@/features/product-gallery/read-gallery-editor.server"
import { readGalleryRequest } from "@/features/product-gallery/read-gallery-request.server"
import { getProductGalleryStore } from "@/features/product-gallery/get-product-gallery-store.server"
import { activateProductGallery } from "@/features/product-gallery/activate-product-gallery.server"
import { galleryErrorResponse } from "@/features/product-gallery/gallery-error-response"
export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60
export async function GET(request: Request, context: { params: Promise<{ product: string }> }) {
  try {
    const { product } = await context.params
    await authorizeGalleryAdmin(request, product)
    return Response.json(await readGalleryEditor(product), { headers: privateResponseHeaders })
  } catch (error) {
    return galleryErrorResponse(error)
  }
}
export async function POST(request: Request, context: { params: Promise<{ product: string }> }) {
  try {
    const { product } = await context.params,
      actor = await authorizeGalleryAdmin(request, product),
      input = await readGalleryRequest(request)
    const result =
      input.action === "activate"
        ? await activateProductGallery(product, input, actor.userId)
        : await getProductGalleryStore().save(product, input, actor.userId, env.NEXT_PUBLIC_PRODUCT_IMAGE_BLOB_HOST)
    return Response.json(result, { headers: privateResponseHeaders })
  } catch (error) {
    return galleryErrorResponse(error)
  }
}
