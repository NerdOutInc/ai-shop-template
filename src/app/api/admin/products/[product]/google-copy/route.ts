import { isGoogleCopyEditingEnabled } from "@/features/merchant-feed/is-google-copy-editing-enabled.server"
import { hasGoogleCopyRequestOrigin } from "@/features/merchant-feed/has-google-copy-request-origin.server"
import { googleCopyErrorResponse } from "@/features/merchant-feed/google-copy-error-response.server"
import { getAdminActor } from "@/features/admin/get-admin-actor.server"
import { readGoogleMerchantCopyEditor } from "@/features/merchant-feed/read-google-merchant-copy-editor.server"
import { prepareGoogleMerchantCopyPreview } from "@/features/merchant-feed/prepare-google-merchant-copy-preview.server"
import { env } from "@/lib/env"
import { privateResponseHeaders } from "@/lib/private-response-headers"
import { readGoogleMerchantCopyApplyRequest } from "@/features/merchant-feed/google-merchant-copy-apply-request"
import { googleMerchantCopyReviewDigest } from "@/features/merchant-feed/google-merchant-copy-review-digest"
import { getPublishingStore } from "@/features/publishing/get-publishing-store.server"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const respond = (body: unknown, status = 200) => Response.json(body, { status, headers: privateResponseHeaders })

export async function GET(request: Request, context: { params: Promise<{ product: string }> }) {
  const site = request.headers.get("sec-fetch-site")
  if (site !== null && site !== "same-origin" && site !== "none")
    return respond({ error: "Use the private product preview." }, 403)
  try {
    if (!(await getAdminActor())) return respond({ error: "Sign in as an administrator." }, 401)
    const { product } = await context.params
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(product)) return respond({ error: "Product not found." }, 404)
    if (!isGoogleCopyEditingEnabled()) return respond({ error: "Publishing is unavailable." }, 503)
    return respond(prepareGoogleMerchantCopyPreview(await readGoogleMerchantCopyEditor(product)).state)
  } catch (error) {
    return googleCopyErrorResponse(error)
  }
}

export async function PUT(request: Request, context: { params: Promise<{ product: string }> }) {
  try {
    if (!hasGoogleCopyRequestOrigin(request)) return respond({ error: "Use the private product preview." }, 403)
    if (!(await getAdminActor())) return respond({ error: "Sign in as an administrator." }, 401)
    const { product } = await context.params
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(product)) return respond({ error: "Product not found." }, 404)
    if (!isGoogleCopyEditingEnabled()) return respond({ error: "Publishing is unavailable." }, 503)
    const input = await readGoogleMerchantCopyApplyRequest(request)
    if (!input) return respond({ error: "Send the frozen preview and explicit confirmation as bounded JSON." }, 400)
    if (
      googleMerchantCopyReviewDigest(env.PRINTIFY_SHOP_ID!, product, input.expectedRevision, input.copy) !==
      input.digest
    )
      return respond({ code: "GOOGLE_COPY_DIGEST_MISMATCH", error: "Make a fresh preview." }, 409)
    prepareGoogleMerchantCopyPreview(await readGoogleMerchantCopyEditor(product), input)
    const result = await getPublishingStore().updateGoogleMerchantCopy(product, input.expectedRevision, input.copy)
    if (!result) return respond({ code: "GOOGLE_COPY_WRITE_BLOCKED", error: "Make a fresh preview." }, 409)
    return respond(result)
  } catch (error) {
    return googleCopyErrorResponse(error)
  }
}
