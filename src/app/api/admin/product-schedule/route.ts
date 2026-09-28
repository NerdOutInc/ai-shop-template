import { z } from "zod"

import { getAdminActor } from "@/features/admin/get-admin-actor.server"
import { listCadenceSlots } from "@/features/publishing/list-cadence-slots"
import { refreshStorefront } from "@/features/design-of-the-week/refresh-storefront.server"
import { getPublishingStore } from "@/features/publishing/get-publishing-store.server"
import { storeConfig } from "@/lib/store-config"
import { env } from "@/lib/env"
import { getSiteUrl } from "@/lib/get-site-url"
import { hasSameOrigin } from "@/lib/has-same-origin"
import { privateResponseHeaders } from "@/lib/private-response-headers"

export const dynamic = "force-dynamic"

const productId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)
const respond = (body: unknown, status = 200) => Response.json(body, { status, headers: privateResponseHeaders })

function sameOrigin(request: Request) {
  const deployment = env.VERCEL_ENV === "preview" && env.VERCEL_URL ? new URL(`https://${env.VERCEL_URL}`) : undefined
  return hasSameOrigin(request, getSiteUrl(), deployment)
}

export async function PUT(request: Request) {
  if (!storeConfig.features.designOfTheWeek) return respond({ error: "Not found." }, 404)
  if (!sameOrigin(request)) return respond({ error: "Use the Products page to schedule products." }, 403)
  const actor = await getAdminActor()
  if (!actor) return respond({ error: "Sign in as an administrator." }, 401)
  const input = z
    .object({ productIds: z.array(productId).min(1).max(100), liveAt: z.iso.datetime() })
    .strict()
    .safeParse(await request.json().catch(() => null))
  if (!input.success || new Set(input.data.productIds).size !== input.data.productIds.length)
    return respond({ error: "Choose published products and a week for their feature." }, 400)
  if (
    !listCadenceSlots({ from: new Date(), count: 6 }).some((slot) => slot.getTime() === Date.parse(input.data.liveAt))
  )
    return respond({ error: "Choose one of the next six weeks. Refresh the page if a date has passed." }, 400)
  try {
    const result = await getPublishingStore().productSchedule.schedule({ ...input.data, featuredBy: actor.userId })
    if (result.status === "missing")
      return respond(
        {
          error: "A selected product is no longer published. Refresh the lineup and try again.",
          productIds: result.productIds,
        },
        409
      )
    if (result.status === "garment-incomplete")
      return respond(
        { error: "Finish the selected products’ garment setup before scheduling them.", productIds: result.productIds },
        409
      )
    if (result.status !== "saved") return respond({ error: "That date has passed. Choose another week." }, 409)
    refreshStorefront()
    return respond({
      entries: result.entries,
      products: result.products,
      now: result.now,
      productIds: input.data.productIds,
    })
  } catch {
    return respond({ error: "The product schedule is temporarily unavailable. Try again shortly." }, 503)
  }
}

export async function DELETE(request: Request) {
  if (!storeConfig.features.designOfTheWeek) return respond({ error: "Not found." }, 404)
  if (!sameOrigin(request)) return respond({ error: "Use the Products page to remove a scheduled product." }, 403)
  const actor = await getAdminActor()
  if (!actor) return respond({ error: "Sign in as an administrator." }, 401)
  const input = z
    .object({ productId })
    .strict()
    .safeParse(await request.json().catch(() => null))
  if (!input.success) return respond({ error: "Choose a scheduled product." }, 400)
  try {
    const result = await getPublishingStore().productSchedule.remove(input.data.productId)
    refreshStorefront()
    return respond({ saved: true, ...result })
  } catch {
    return respond({ error: "The product schedule is temporarily unavailable. Try again shortly." }, 503)
  }
}
