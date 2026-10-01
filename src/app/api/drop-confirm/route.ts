import { z } from "zod"
import { getDropSignupStore } from "@/features/drop-signup/get-drop-signup-store.server"
import { getPublicRequestIdentity } from "@/features/drop-signup/get-public-request-identity.server"
import { readSignupBody } from "@/features/drop-signup/read-signup-body.server"
import { storeConfig } from "@/lib/store-config"
import { env } from "@/lib/env"
import { getSiteUrl } from "@/lib/get-site-url"
import { hasSameOrigin } from "@/lib/has-same-origin"
import { privateResponseHeaders } from "@/lib/private-response-headers"

export async function POST(request: Request) {
  const respond = (body: unknown, status = 200) => Response.json(body, { status, headers: privateResponseHeaders })
  const deployment = env.VERCEL_ENV === "preview" && env.VERCEL_URL ? new URL(`https://${env.VERCEL_URL}`) : undefined
  if (!hasSameOrigin(request, getSiteUrl(), deployment)) return respond({ error: "Use the confirmation page." }, 403)
  // Preview databases can share a production connection. A capability must not turn that into a
  // production consent write through an unreviewed deployment. Existing production links still
  // work when only confirmation sending is switched off.
  if (
    env.VERCEL_ENV !== "production" ||
    !storeConfig.configured ||
    !storeConfig.policies.published ||
    (!storeConfig.features.dropSignup && !storeConfig.privacy.retainedDropSubscribers)
  )
    return respond({ error: "Confirmation is unavailable here." }, 503)
  const body = await readSignupBody(request)
  if (body.status !== "read") return respond({ error: "Invalid confirmation." }, 400)
  const input = z
    .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
    .strict()
    .safeParse(body.value)
  if (!input.success) return respond({ status: "expired" }, 410)
  const identity = await getPublicRequestIdentity()
  if (!identity) return respond({ error: "Please try again." }, 400)
  try {
    const store = getDropSignupStore()
    if (!(await store.allowRequest(`confirmation:${identity.subject}`, identity.limit)))
      return respond({ error: "Try again in a few minutes." }, 429)
    const status = await store.confirm(input.data.token)
    return respond({ status }, status === "confirmed" ? 200 : 410)
  } catch {
    console.warn("Drop confirmation unavailable", { reason: "storage" })
    return respond({ error: "Confirmation is taking a breather. Try again shortly." }, 503)
  }
}
