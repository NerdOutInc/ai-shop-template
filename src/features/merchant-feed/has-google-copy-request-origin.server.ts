import "server-only"

import { env } from "@/lib/env"
import { getSiteUrl } from "@/lib/get-site-url"
import { hasSameOrigin } from "@/lib/has-same-origin"

export function hasGoogleCopyRequestOrigin(request: Request) {
  const deployment = env.VERCEL_ENV === "preview" && env.VERCEL_URL ? new URL(`https://${env.VERCEL_URL}`) : undefined
  return hasSameOrigin(request, getSiteUrl(), deployment)
}
