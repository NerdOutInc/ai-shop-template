"use client"

import { createBrowserClient } from "@supabase/ssr"
import { env } from "@/lib/env"
import { isAdminLocalDevelopment } from "./is-admin-local-development"

export function createAdminBrowserClient() {
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
    throw new Error("Admin authentication is not configured")
  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookieOptions: { secure: !isAdminLocalDevelopment() },
    auth: { experimental: { passkey: true } },
  })
}
