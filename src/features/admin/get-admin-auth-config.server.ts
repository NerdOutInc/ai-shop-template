import "server-only"

import { env } from "@/lib/env"

export function getAdminAuthConfig() {
  if (!env.ADMIN_LIBRARY_ENABLED || !env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
    return null
  const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL)
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  )
    return null
  return { url: url.toString(), key: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY }
}
