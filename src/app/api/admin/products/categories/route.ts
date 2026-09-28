import { z } from "zod"

import { getAdminActor } from "@/features/admin/get-admin-actor.server"
import { refreshStorefront } from "@/features/design-of-the-week/refresh-storefront.server"
import { categoryNameSchema } from "@/features/garment-catalog/category-name-schema"
import { slugifyCategoryName } from "@/features/garment-catalog/slugify-category-name"
import { getPublishingStore } from "@/features/publishing/get-publishing-store.server"
import { env } from "@/lib/env"
import { getSiteUrl } from "@/lib/get-site-url"
import { hasSameOrigin } from "@/lib/has-same-origin"
import { privateResponseHeaders } from "@/lib/private-response-headers"

export const dynamic = "force-dynamic"

// Saved categories supply cached public garment labels, so successful writes refresh the storefront.

function guard(request: Request) {
  const deployment = env.VERCEL_ENV === "preview" && env.VERCEL_URL ? new URL(`https://${env.VERCEL_URL}`) : undefined
  return hasSameOrigin(request, getSiteUrl(), deployment)
}

/**
 * Creates a category. The slug is made here, once, from the name and never sent by the client: it
 * is the category's identity and becomes URL state, so nobody gets to pick one that a later rename
 * would seem to contradict.
 */
export async function POST(request: Request) {
  const respond = (body: unknown, status = 200) => Response.json(body, { status, headers: privateResponseHeaders })
  if (!guard(request)) return respond({ error: "Use the Products page to manage categories." }, 403)
  const actor = await getAdminActor()
  if (!actor) return respond({ error: "Sign in as an administrator." }, 401)
  const input = z
    .object({ name: categoryNameSchema })
    .strict()
    .safeParse(await request.json().catch(() => null))
  // A name with nothing a URL can spell ("!!!", "日本語") has no slug, so it has no identity to save.
  const slug = input.success ? slugifyCategoryName(input.data.name) : null
  if (!input.success || !slug) return respond({ error: "Give the category a name." }, 400)
  try {
    const result = await getPublishingStore().garments.createCategory({ slug, name: input.data.name })
    // Two names can differ and still share a slug ("Crop tops" and "Crop-Tops!"). The owner would be
    // looking at two categories they cannot tell apart, so it reads as the same refusal.
    if (result.status === "taken") return respond({ error: "A category with that name already exists." }, 409)
    refreshStorefront()
    return respond({ category: result.category })
  } catch {
    return respond({ error: "Categories are temporarily unavailable. Try again shortly." }, 503)
  }
}

/**
 * Saves the owner's category order. Like the featured-order PUT it sends the whole list, so the
 * store's set-equality check IS the staleness guard and this is the one category write with a 409.
 * The reorder lives on the collection rather than at `categories/order` because a category slugged
 * "order" would then be unreachable.
 */
export async function PUT(request: Request) {
  const respond = (body: unknown, status = 200) => Response.json(body, { status, headers: privateResponseHeaders })
  if (!guard(request)) return respond({ error: "Use the Products page to manage categories." }, 403)
  const actor = await getAdminActor()
  if (!actor) return respond({ error: "Sign in as an administrator." }, 401)
  const input = z
    .object({
      categorySlugs: z
        .array(
          z
            .string()
            .max(64)
            .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
        )
        .min(1)
        .max(100),
    })
    .strict()
    .safeParse(await request.json().catch(() => null))
  if (!input.success) return respond({ error: "List every category in its new order." }, 400)
  try {
    if ((await getPublishingStore().garments.reorderCategories(input.data.categorySlugs)) === "changed")
      return respond({ error: "The categories changed. Reload to sort the latest list." }, 409)
  } catch {
    return respond({ error: "Categories are temporarily unavailable. Try again shortly." }, 503)
  }
  refreshStorefront()
  return respond({ saved: true })
}
