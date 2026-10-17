import { isGoogleCopyEditingEnabled } from "@/features/merchant-feed/is-google-copy-editing-enabled.server"
import { hasGoogleCopyRequestOrigin } from "@/features/merchant-feed/has-google-copy-request-origin.server"
import { googleCopyErrorResponse } from "@/features/merchant-feed/google-copy-error-response.server"
import { getAdminActor } from "@/features/admin/get-admin-actor.server"
import { readGoogleMerchantCopyEditor } from "@/features/merchant-feed/read-google-merchant-copy-editor.server"
import { prepareGoogleMerchantCopyPreview } from "@/features/merchant-feed/prepare-google-merchant-copy-preview.server"
import { privateResponseHeaders } from "@/lib/private-response-headers"
import { readGoogleMerchantCopyPreviewRequest } from "@/features/merchant-feed/google-merchant-copy-preview-request"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const respond = (body: unknown, status = 200) => Response.json(body, { status, headers: privateResponseHeaders })

export async function POST(request: Request, context: { params: Promise<{ product: string }> }) {
  try {
    if (!hasGoogleCopyRequestOrigin(request)) return respond({ error: "Use the private product preview." }, 403)
    if (!(await getAdminActor())) return respond({ error: "Sign in as an administrator." }, 401)
    const { product } = await context.params
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(product)) return respond({ error: "Product not found." }, 404)
    if (!isGoogleCopyEditingEnabled()) return respond({ error: "Publishing is unavailable." }, 503)
    const input = await readGoogleMerchantCopyPreviewRequest(request)
    if (!input) return respond({ error: "Choose wording, origin and exact variants using bounded JSON." }, 400)
    return respond(prepareGoogleMerchantCopyPreview(await readGoogleMerchantCopyEditor(product), input).preview)
  } catch (error) {
    return googleCopyErrorResponse(error)
  }
}
