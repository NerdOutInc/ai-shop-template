import { z } from "zod"

import { getAdminActor } from "@/features/admin/get-admin-actor.server"
import { LibraryError } from "@/features/design-library/library-error"
import { DesignDraftError } from "@/features/design-products/design-draft-error"
import { proposeAdminDesignDraft } from "@/features/design-products/propose-admin-design-draft.server"
import { runAdminDesignDraft } from "@/features/design-products/run-admin-design-draft.server"
import { env } from "@/lib/env"
import { getSiteUrl } from "@/lib/get-site-url"
import { hasSameOrigin } from "@/lib/has-same-origin"
import { privateResponseHeaders } from "@/lib/private-response-headers"

export const runtime = "nodejs"
// One draft step uploads artwork and creates a product inside a 50-second deadline of its own.
export const maxDuration = 60
export const dynamic = "force-dynamic"

const respond = (value: unknown, status = 200) => Response.json(value, { status, headers: privateResponseHeaders })
const number = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const step = z
  .object({
    action: z.enum(["create", "reconcile"]),
    requestId: z.uuid(),
    displayNumber: number,
    revisionId: z.uuid(),
  })
  .strict()

function failure(error: unknown) {
  if (error instanceof DesignDraftError) {
    const status = {
      INVALID_INPUT: 400,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
      PROVIDER_REJECTED: 502,
      PROVIDER_UNAVAILABLE: 503,
    }[error.code]
    // Draft errors are already written for the owner and carry no provider body or capability URL.
    return respond({ error: error.message }, status)
  }
  if (error instanceof LibraryError && error.code === "FORBIDDEN")
    return respond({ error: "Sign in as a current administrator." }, 403)
  return respond({ error: "Printify drafts are temporarily unavailable. Try again shortly." }, 503)
}

/** What the button would create. Reads only; nothing is reserved here or at Printify. */
export async function GET(request: Request, context: { params: Promise<{ design: string }> }) {
  const actor = await getAdminActor()
  if (!actor) return respond({ error: "Sign in as an administrator." }, 401)
  const { design: designId } = await context.params
  const query = new URL(request.url).searchParams
  const input = z
    .object({ designId: z.uuid(), displayNumber: number, revisionId: z.uuid() })
    .safeParse({ designId, displayNumber: query.get("number"), revisionId: query.get("revision") })
  if (!input.success) return respond({ error: "Design not found." }, 404)
  try {
    const { design, modelLabel, proposal } = await proposeAdminDesignDraft(actor.userId, input.data, {
      signal: request.signal,
    })
    return respond({
      title: design.title,
      modelLabel,
      colors: proposal.colors,
      sizes: proposal.sizes,
      skipped: proposal.skipped,
      blockers: proposal.blockers,
      placementDonor: proposal.placementDonor,
      unverified: proposal.unverified,
    })
  } catch (error) {
    return failure(error)
  }
}

export async function POST(request: Request, context: { params: Promise<{ design: string }> }) {
  const deployment = env.VERCEL_ENV === "preview" && env.VERCEL_URL ? new URL(`https://${env.VERCEL_URL}`) : undefined
  if (!hasSameOrigin(request, getSiteUrl(), deployment))
    return respond({ error: "Use the design library to create a Printify draft." }, 403)
  const actor = await getAdminActor()
  if (!actor) return respond({ error: "Sign in as an administrator." }, 401)
  const { design: designId } = await context.params
  if (!z.uuid().safeParse(designId).success) return respond({ error: "Design not found." }, 404)
  const input = step.safeParse(await request.json().catch(() => null))
  if (!input.success) return respond({ error: "Reload this design and try again." }, 400)
  try {
    const outcome = await runAdminDesignDraft(actor.userId, { ...input.data, designId }, { signal: request.signal })
    const result = outcome.results.find((entry) => entry.designId === designId) ?? null
    return respond({ requestId: outcome.requestId, pending: outcome.pending, result })
  } catch (error) {
    return failure(error)
  }
}
