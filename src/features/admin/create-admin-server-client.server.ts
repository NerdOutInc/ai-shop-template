import "server-only"

import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { getAdminAuthConfig } from "./get-admin-auth-config.server"
import { isAdminLocalDevelopment } from "./is-admin-local-development"

export async function createAdminServerClient() {
  const config = getAdminAuthConfig()
  if (!config) throw new Error("Admin authentication is not configured")
  const cookieStore = await cookies()
  return createServerClient(config.url, config.key, {
    cookieOptions: { secure: !isAdminLocalDevelopment() },
    auth: { experimental: { passkey: true } },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options)
        } catch {
          // Server Components cannot write cookies; the admin-only Proxy refreshes them first.
        }
      },
    },
  })
}
