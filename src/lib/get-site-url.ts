import "server-only"

import { env } from "./env"

export function getSiteUrl(): URL {
  // Public search identities stay on the store domain, including protected previews.
  return new URL(new URL(env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").origin)
}
