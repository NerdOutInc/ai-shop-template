import { subscribeToDrops } from "@/features/drop-signup/subscribe-to-drops.server"
import { dropSignupRequest } from "@/features/drop-signup/drop-signup-request"
import { readSignupBody } from "@/features/drop-signup/read-signup-body.server"
import { storeConfig } from "@/lib/store-config"
import { env } from "@/lib/env"
import { getSiteUrl } from "@/lib/get-site-url"
import { hasSameOrigin } from "@/lib/has-same-origin"
import { privateResponseHeaders } from "@/lib/private-response-headers"

export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * The public request for inbox confirmation.
 *
 * A Route Handler rather than a Server Action so the whole guard chain is testable as ordinary code.
 * Progressive enhancement was considered and deferred: this repo's existing action is called
 * imperatively from a client component anyway, and a later action can call subscribeToDrops without
 * moving a single guard.
 *
 * The same-origin check is CSRF protection for browsers and nothing more — curl sets Origin at will.
 * The rate limit is what actually bounds abuse, and it is honest about its ceiling: application-level
 * only, so it cannot stop a distributed flood.
 */
export async function POST(request: Request) {
  const respond = (body: unknown, status = 200) => Response.json(body, { status, headers: privateResponseHeaders })
  if (!storeConfig.features.dropSignup) return respond({ error: "Not found." }, 404)
  const deployment = env.VERCEL_ENV === "preview" && env.VERCEL_URL ? new URL(`https://${env.VERCEL_URL}`) : undefined
  if (!hasSameOrigin(request, getSiteUrl(), deployment)) return respond({ error: "Use the form on the site." }, 403)

  const body = await readSignupBody(request)
  if (body.status !== "read")
    return respond({ error: "That didn't look like a sign-up." }, body.status === "too-large" ? 413 : 415)
  const input = dropSignupRequest.safeParse(body.value)
  if (!input.success) return respond({ error: "Check that email address and try again." }, 400)

  const result = await subscribeToDrops(input.data)
  if (result === "rate-limited") return respond({ error: "That's a few tries in a row. Give it a few minutes." }, 429)
  if (result === "unidentified") return respond({ error: "We couldn't take that sign-up. Please try again." }, 400)
  if (result === "unavailable") return respond({ error: "Sign-ups are taking a breather. Try again shortly." }, 503)
  return respond({ requested: true })
}
