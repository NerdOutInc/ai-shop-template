import "server-only"
import { getAdminActor } from "@/features/admin/get-admin-actor.server"
import { storeConfig } from "@/lib/store-config"
import { env } from "@/lib/env"
import { getSiteUrl } from "@/lib/get-site-url"
import { hasSameOrigin } from "@/lib/has-same-origin"
import { privateResponseHeaders } from "@/lib/private-response-headers"

export async function authorizeHeroAdmin(request: Request) {
  if (!storeConfig.features.designOfTheWeek)
    return Response.json({ error: "Not found." }, { status: 404, headers: privateResponseHeaders })
  const deployment = env.VERCEL_ENV === "preview" && env.VERCEL_URL ? new URL(`https://${env.VERCEL_URL}`) : undefined
  if (request.method !== "GET" && !hasSameOrigin(request, getSiteUrl(), deployment))
    return Response.json(
      { error: "Use the weekly hero editor to make changes." },
      { status: 403, headers: privateResponseHeaders }
    )
  const actor = await getAdminActor()
  return (
    actor ?? Response.json({ error: "Sign in as an administrator." }, { status: 401, headers: privateResponseHeaders })
  )
}
