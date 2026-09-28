import { revalidateTag } from "next/cache"
import { z } from "zod"

import { getAdminActor } from "@/features/admin/get-admin-actor.server"
import { getPublishingStore } from "@/features/publishing/get-publishing-store.server"
import { env } from "@/lib/env"
import { getSiteUrl } from "@/lib/get-site-url"
import { hasSameOrigin } from "@/lib/has-same-origin"
import { privateResponseHeaders } from "@/lib/private-response-headers"

export const dynamic = "force-dynamic"

export async function PUT(request: Request) {
  const respond = (body: unknown, status = 200) => Response.json(body, { status, headers: privateResponseHeaders })
  const deployment = env.VERCEL_ENV === "preview" && env.VERCEL_URL ? new URL(`https://${env.VERCEL_URL}`) : undefined
  if (!hasSameOrigin(request, getSiteUrl(), deployment))
    return respond({ error: "Use the Products page to change the featured order." }, 403)
  const actor = await getAdminActor()
  if (!actor) return respond({ error: "Sign in as an administrator." }, 401)
  const input = z
    .object({ productIds: z.array(z.string().min(1).max(128)).min(1).max(500) })
    .strict()
    .safeParse(await request.json().catch(() => null))
  if (!input.success) return respond({ error: "List every product in its new order." }, 400)
  try {
    const result = await getPublishingStore().reorderProducts(input.data.productIds)
    if (result === "changed")
      return respond({ error: "The product list changed. Reload to sort the latest products." }, 409)
  } catch {
    return respond({ error: "The featured order is temporarily unavailable. Try again shortly." }, 503)
  }
  revalidateTag("printify-published-catalog", { expire: 0 })
  return respond({ saved: true })
}
