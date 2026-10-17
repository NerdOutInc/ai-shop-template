import { getAdminActor } from "@/features/admin/get-admin-actor.server"
import { readGoogleMerchantCopyEditor } from "@/features/merchant-feed/read-google-merchant-copy-editor.server"
import { prepareGoogleMerchantCopyPreview } from "@/features/merchant-feed/prepare-google-merchant-copy-preview.server"
import { env } from "@/lib/env"
import { getSiteUrl } from "@/lib/get-site-url"
import { hasSameOrigin } from "@/lib/has-same-origin"
import { privateResponseHeaders } from "@/lib/private-response-headers"
import { readGoogleMerchantCopyApplyRequest } from "@/features/merchant-feed/google-merchant-copy-apply-request"
import { googleMerchantCopyReviewDigest } from "@/features/merchant-feed/google-merchant-copy-review-digest"
import { getPublishingStore } from "@/features/publishing/get-publishing-store.server"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const respond = (body: unknown, status = 200) => Response.json(body, { status, headers: privateResponseHeaders })
const guardCodes = new Set([
  "GOOGLE_COPY_INVALID_TARGET",
  "GOOGLE_COPY_INVALID_RECORD",
  "GOOGLE_COPY_WRITE_BLOCKED",
  "GOOGLE_COPY_REVISION_CHANGED",
  "GOOGLE_COPY_INVALID_SNAPSHOT",
  "GOOGLE_COPY_UNSUPPORTED_BLUEPRINT",
  "GOOGLE_COPY_INVALID_SELECTION",
  "GOOGLE_COPY_METADATA_CONFLICT",
  "GOOGLE_COPY_INVALID_APPROVAL",
  "GOOGLE_COPY_ORIGIN_DOWNGRADE",
  "GOOGLE_COPY_PROVENANCE_INCOMPLETE",
])
function failure(error: unknown) {
  if (error instanceof Error && guardCodes.has(error.message))
    return respond(
      { code: error.message, error: "Copy could not be applied. Read the saved state and make a fresh preview." },
      409
    )
  return respond(
    { code: "GOOGLE_COPY_UNKNOWN", error: "Outcome unknown. Read the saved state before deciding what to do next." },
    503
  )
}
function sameOrigin(request: Request) {
  const deployment = env.VERCEL_ENV === "preview" && env.VERCEL_URL ? new URL(`https://${env.VERCEL_URL}`) : undefined
  return hasSameOrigin(request, getSiteUrl(), deployment)
}
function enabled() {
  return (
    env.PRINTIFY_PUBLISHING_ENABLED &&
    env.DATABASE_URL &&
    env.PRINTIFY_SHOP_ID &&
    /^[1-9]\d*$/.test(env.PRINTIFY_SHOP_ID)
  )
}

export async function GET(request: Request, context: { params: Promise<{ product: string }> }) {
  const site = request.headers.get("sec-fetch-site")
  if (site !== null && site !== "same-origin" && site !== "none")
    return respond({ error: "Use the private product preview." }, 403)
  try {
    if (!(await getAdminActor())) return respond({ error: "Sign in as an administrator." }, 401)
    const { product } = await context.params
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(product)) return respond({ error: "Product not found." }, 404)
    if (!enabled()) return respond({ error: "Publishing is unavailable." }, 503)
    return respond(prepareGoogleMerchantCopyPreview(await readGoogleMerchantCopyEditor(product)).state)
  } catch (error) {
    return failure(error)
  }
}

export async function PUT(request: Request, context: { params: Promise<{ product: string }> }) {
  try {
    if (!sameOrigin(request)) return respond({ error: "Use the private product preview." }, 403)
    if (!(await getAdminActor())) return respond({ error: "Sign in as an administrator." }, 401)
    const { product } = await context.params
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(product)) return respond({ error: "Product not found." }, 404)
    if (!enabled()) return respond({ error: "Publishing is unavailable." }, 503)
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
    return failure(error)
  }
}
