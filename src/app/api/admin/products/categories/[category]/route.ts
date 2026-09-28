import { z } from "zod"

import { getAdminActor } from "@/features/admin/get-admin-actor.server"
import { refreshStorefront } from "@/features/design-of-the-week/refresh-storefront.server"
import { categoryNameSchema } from "@/features/garment-catalog/category-name-schema"
import { getPublishingStore } from "@/features/publishing/get-publishing-store.server"
import { env } from "@/lib/env"
import { getSiteUrl } from "@/lib/get-site-url"
import { hasSameOrigin } from "@/lib/has-same-origin"
import { privateResponseHeaders } from "@/lib/private-response-headers"

export const dynamic = "force-dynamic"

// Saved category names appear in cached garment labels; refresh only after a successful mutation.

const respond = (body: unknown, status = 200) => Response.json(body, { status, headers: privateResponseHeaders })

/** The checks both verbs share, in the order every admin route runs them. Answers a refusal or the slug. */
async function authorize(request: Request, context: { params: Promise<{ category: string }> }) {
  const deployment = env.VERCEL_ENV === "preview" && env.VERCEL_URL ? new URL(`https://${env.VERCEL_URL}`) : undefined
  if (!hasSameOrigin(request, getSiteUrl(), deployment))
    return respond({ error: "Use the Products page to manage categories." }, 403)
  const actor = await getAdminActor()
  if (!actor) return respond({ error: "Sign in as an administrator." }, 401)
  const { category: slug } = await context.params
  // Same pattern and length as the check on commerce.shop_categories.slug.
  if (slug.length > 64 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return respond({ error: "Category not found." }, 404)
  return slug
}

/**
 * Renames a category, and only renames it. The slug in the path is the identity and becomes URL
 * state, so a body carrying `slug` is refused outright rather than quietly ignored. Setting one name
 * is idempotent, so like the visibility PUT this carries no staleness 409; the only conflict is a
 * name another category already has.
 */
export async function PUT(request: Request, context: { params: Promise<{ category: string }> }) {
  const slug = await authorize(request, context)
  if (slug instanceof Response) return slug
  const input = z
    .object({ name: categoryNameSchema })
    .strict()
    .safeParse(await request.json().catch(() => null))
  if (!input.success) return respond({ error: "Give the category a name." }, 400)
  try {
    const result = await getPublishingStore().garments.renameCategory(slug, input.data.name)
    if (result === "missing") return respond({ error: "That category no longer exists." }, 404)
    if (result === "taken") return respond({ error: "A category with that name already exists." }, 409)
  } catch {
    return respond({ error: "Categories are temporarily unavailable. Try again shortly." }, 503)
  }
  refreshStorefront()
  return respond({ slug, name: input.data.name })
}

/** Deletes an unused category. The path names it, so there is no body to read. */
export async function DELETE(request: Request, context: { params: Promise<{ category: string }> }) {
  const slug = await authorize(request, context)
  if (slug instanceof Response) return slug
  try {
    const result = await getPublishingStore().garments.deleteCategory(slug)
    if (result === "missing") return respond({ error: "That category no longer exists." }, 404)
    if (result !== "saved") {
      // Refused rather than cascaded: a garment that silently lost its category would stop being
      // complete while its products are still in the shop.
      const { garments } = result
      const error =
        garments === 1
          ? "1 garment still uses this category. Move it to another category first."
          : `${garments} garments still use this category. Move them to another category first.`
      return respond({ error, garments }, 409)
    }
  } catch {
    return respond({ error: "Categories are temporarily unavailable. Try again shortly." }, 503)
  }
  refreshStorefront()
  return respond({ deleted: true })
}
