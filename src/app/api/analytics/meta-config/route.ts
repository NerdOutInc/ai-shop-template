import { env } from "@/lib/env"
import { getSiteUrl } from "@/lib/get-site-url"

export const dynamic = "force-dynamic"

export function GET() {
  const canonicalOrigin = getSiteUrl().origin
  const pixelId = env.META_PIXEL_ID ?? ""
  const enabled =
    env.META_PIXEL_ENABLED === "true" &&
    env.VERCEL_ENV === "production" &&
    env.NODE_ENV === "production" &&
    /^\d{5,25}$/.test(pixelId) &&
    canonicalOrigin.startsWith("https://")
  return Response.json(
    { enabled, pixelId: enabled ? pixelId : "", canonicalOrigin },
    { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } }
  )
}
