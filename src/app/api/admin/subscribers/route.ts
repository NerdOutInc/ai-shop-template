import { getAdminActor } from "@/features/admin/get-admin-actor.server"
import { getDropEmailPool } from "@/features/drop-emails/get-drop-email-pool.server"
import { getDropSignupStore } from "@/features/drop-signup/get-drop-signup-store.server"
import { readSignupBody } from "@/features/drop-signup/read-signup-body.server"
import { SubscriberAdminStore } from "@/features/subscribers/subscriber-admin-store.server"
import { subscriberAdminRequest } from "@/features/subscribers/subscriber-admin-request"
import { storeConfig } from "@/lib/store-config"
import { env } from "@/lib/env"
import { getSiteUrl } from "@/lib/get-site-url"
import { hasSameOrigin } from "@/lib/has-same-origin"
import { privateResponseHeaders } from "@/lib/private-response-headers"

export const dynamic = "force-dynamic"
const respond = (body: unknown, status = 200) => Response.json(body, { status, headers: privateResponseHeaders })

/** Addresses and capability UUIDs travel only in private POST bodies, never new URL paths. */
export async function POST(request: Request) {
  const deployment = env.VERCEL_ENV === "preview" && env.VERCEL_URL ? new URL(`https://${env.VERCEL_URL}`) : undefined
  if (!hasSameOrigin(request, getSiteUrl(), deployment)) return respond({ error: "Use the Drop emails page." }, 403)
  if (!(await getAdminActor()))
    return respond({ error: "Administrator access could not be verified. Sign in and try again." }, 401)
  if (
    !storeConfig.configured ||
    !storeConfig.policies.published ||
    (!storeConfig.features.dropSignup && !storeConfig.privacy.retainedDropSubscribers)
  )
    return respond({ error: "Subscriber support is unavailable for this list." }, 503)
  try {
    const body = await readSignupBody(request, 2048)
    if (body.status !== "read")
      return respond({ error: "Send a small JSON request." }, body.status === "too-large" ? 413 : 415)
    const parsed = subscriberAdminRequest.safeParse(body.value)
    if (!parsed.success) return respond({ error: "Check the subscriber request." }, 400)
    const input = parsed.data
    const store = new SubscriberAdminStore(getDropEmailPool())
    if (input.action === "lookup") return respond({ subscriber: await store.lookup(input.email) })
    await getDropSignupStore().unsubscribe(input.id)
    return respond({ subscriber: await store.readById(input.id) })
  } catch {
    console.warn("Subscriber administration unavailable", { reason: "storage" })
    return respond({ error: "The change could not be confirmed. Look up the subscriber again before retrying." }, 503)
  }
}
