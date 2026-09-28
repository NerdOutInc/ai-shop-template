import { revalidatePath, revalidateTag } from "next/cache"
import { z } from "zod"

import { getAdminActor } from "@/features/admin/get-admin-actor.server"
import { getPublishingStore } from "@/features/publishing/get-publishing-store.server"
import { env } from "@/lib/env"
import { getSiteUrl } from "@/lib/get-site-url"
import { hasSameOrigin } from "@/lib/has-same-origin"
import { privateResponseHeaders } from "@/lib/private-response-headers"

export const dynamic = "force-dynamic"

/**
 * Deliberately per-product and without a STALENESS 409, unlike the featured-order PUT. That route
 * sends the whole lineup, so its set-equality check IS its staleness guard. Setting one product to a
 * known state is idempotent and commutative, so two tabs cannot corrupt each other; carrying
 * visibility on the lineup body instead would let a stale tab's idea of "shown" ride past that guard
 * unnoticed.
 *
 * The one 409 here is a refusal, not a staleness guard: a hidden product whose garment has no
 * category and apparel details yet may not be shown. Reloading does not help; finishing the garment
 * does. Hiding is never refused, because hiding is the owner's safety action.
 */
export async function PUT(request: Request, context: { params: Promise<{ product: string }> }) {
  const respond = (body: unknown, status = 200) => Response.json(body, { status, headers: privateResponseHeaders })
  const deployment = env.VERCEL_ENV === "preview" && env.VERCEL_URL ? new URL(`https://${env.VERCEL_URL}`) : undefined
  if (!hasSameOrigin(request, getSiteUrl(), deployment))
    return respond({ error: "Use the Products page to change what the shop shows." }, 403)
  const actor = await getAdminActor()
  if (!actor) return respond({ error: "Sign in as an administrator." }, 401)
  const { product: productId } = await context.params
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(productId)) return respond({ error: "Product not found." }, 404)
  const input = z
    .object({ hidden: z.boolean() })
    .strict()
    .safeParse(await request.json().catch(() => null))
  if (!input.success) return respond({ error: "Say whether the shop should hide this product." }, 400)
  let visibility: {
    hiddenAt: string | null
    revealAt: string | null
    revealedAt: string | null
    addedToShopAt: string | null
  }
  try {
    const result = await getPublishingStore().setProductHidden(productId, input.data.hidden)
    if (result === "missing") return respond({ error: "That product is no longer published." }, 404)
    // Nothing changed, so nothing below is refreshed. The code lets the Products page offer a link to
    // the garment instead of "try again", which would never work.
    if (result === "garment-incomplete")
      return respond(
        {
          error:
            "This product's garment still needs a category and apparel details. Finish it under Garment models, then show it.",
          code: "GARMENT_INCOMPLETE",
        },
        409
      )
    visibility = {
      hiddenAt: result.hiddenAt,
      revealAt: result.revealAt,
      revealedAt: result.revealedAt,
      addedToShopAt: result.addedToShopAt,
    }
  } catch {
    return respond({ error: "The shop lineup is temporarily unavailable. Try again shortly." }, 503)
  }
  revalidateTag("printify-published-catalog", { expire: 0 })
  // The sitemap and both feeds render outside that tag, so the whole tree has to drop its cache too.
  revalidatePath("/", "layout")
  return respond({ productId, hidden: input.data.hidden, ...visibility })
}
