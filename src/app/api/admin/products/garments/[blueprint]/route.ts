import { getAdminActor } from "@/features/admin/get-admin-actor.server"
import { refreshStorefront } from "@/features/design-of-the-week/refresh-storefront.server"
import { garmentSetupSchema } from "@/features/garment-catalog/garment-setup-schema"
import { getPublishingStore } from "@/features/publishing/get-publishing-store.server"
import { env } from "@/lib/env"
import { getSiteUrl } from "@/lib/get-site-url"
import { hasSameOrigin } from "@/lib/has-same-origin"
import { privateResponseHeaders } from "@/lib/private-response-headers"

export const dynamic = "force-dynamic"

/**
 * Saves one garment's whole setup, which is also how a garment is added ahead of its first product.
 * The body is the entire row (null means "not chosen yet"), so the PUT is idempotent and carries no
 * staleness 409. Its one 409 is a refusal: a complete garment may not lose its setup while products
 * on it are in the shop or scheduled. It REFUSES rather than hiding or unscheduling them.
 * A successful save refreshes the cached public garment labels. Merchant feeds and publishing
 * health continue to read their apparel profiles uncached on the next request.
 */
export async function PUT(request: Request, context: { params: Promise<{ blueprint: string }> }) {
  const respond = (body: unknown, status = 200) => Response.json(body, { status, headers: privateResponseHeaders })
  const deployment = env.VERCEL_ENV === "preview" && env.VERCEL_URL ? new URL(`https://${env.VERCEL_URL}`) : undefined
  if (!hasSameOrigin(request, getSiteUrl(), deployment))
    return respond({ error: "Use the Products page to set up garments." }, 403)
  const actor = await getAdminActor()
  if (!actor) return respond({ error: "Sign in as an administrator." }, 401)
  const { blueprint } = await context.params
  // A Printify blueprint number and nothing else. A pasted catalog link is parsed in the browser;
  // this boundary never sees a URL.
  if (!/^[1-9]\d{0,8}$/.test(blueprint)) return respond({ error: "Garment not found." }, 404)
  const blueprintId = Number(blueprint)
  const input = garmentSetupSchema.safeParse(await request.json().catch(() => null))
  if (!input.success) return respond({ error: "Check the garment's name, category and apparel details." }, 400)
  try {
    const result = await getPublishingStore().garments.saveGarment(blueprintId, input.data)
    if (result === "invalid-category")
      return respond({ error: "That category no longer exists. Reload and choose another." }, 404)
    if (result !== "saved") {
      const { products } = result
      const error =
        products === 1
          ? "1 product on this garment is in the shop or scheduled. Hide it before clearing its setup."
          : `${products} products on this garment are in the shop or scheduled. Hide them before clearing its setup.`
      return respond({ error, products }, 409)
    }
  } catch {
    return respond({ error: "Garment setup is temporarily unavailable. Try again shortly." }, 503)
  }
  refreshStorefront()
  return respond({ blueprintId })
}
