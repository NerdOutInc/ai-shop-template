import "server-only"
import { getAdminActor } from "@/features/admin/get-admin-actor.server"
import { env } from "@/lib/env"
import { getSiteUrl } from "@/lib/get-site-url"
import { hasSameOrigin } from "@/lib/has-same-origin"
import { GalleryError } from "./gallery-error"
export async function authorizeGalleryAdmin(request: Request, product: string) {
  const deployment = env.VERCEL_ENV === "preview" && env.VERCEL_URL ? new URL(`https://${env.VERCEL_URL}`) : undefined
  const site = request.headers.get("sec-fetch-site")
  if (
    request.method !== "GET"
      ? !hasSameOrigin(request, getSiteUrl(), deployment)
      : site !== null && !["same-origin", "none"].includes(site)
  )
    throw new GalleryError("Use the private product photo editor.", 403)
  const actor = await getAdminActor()
  if (!actor) throw new GalleryError("Sign in as an administrator.", 401)
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(product)) throw new GalleryError("Product not found.", 404)
  return actor
}
