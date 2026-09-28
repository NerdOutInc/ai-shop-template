import { env } from "@/lib/env"
import { getSiteUrl } from "@/lib/get-site-url"

export const dynamic = "force-dynamic"

export function GET() {
  const canonicalOrigin = getSiteUrl().origin
  const tagId = env.GOOGLE_TAG_ID ?? ""
  const enabled =
    env.GOOGLE_TAG_ENABLED === "true" &&
    env.VERCEL_ENV === "production" &&
    env.NODE_ENV === "production" &&
    /^GT-[A-Z0-9]{4,20}$/.test(tagId) &&
    canonicalOrigin.startsWith("https://")
  return Response.json(
    { enabled, tagId: enabled ? tagId : "", canonicalOrigin },
    { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } }
  )
}
