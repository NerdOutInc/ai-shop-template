import "server-only"

import { createClient } from "@supabase/supabase-js"
import { env } from "@/lib/env"
import type { AdminStore } from "./admin-store.server"
import { getAdminAuthConfig } from "./get-admin-auth-config.server"

export async function prepareAdminOwner(store: AdminStore, email: string): Promise<boolean> {
  const config = getAdminAuthConfig()
  if (!config || !env.SUPABASE_SECRET_KEY) return false
  const userId = await store.reserveOwner(email)
  if (!userId) return false
  const provisioning = createClient(config.url, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  // Only the Admin API can choose this reserved ID. Existing emails are rejected, not updated.
  // Confirm at creation so public signup cannot attach a password to an unconfirmed account.
  // No password is supplied or returned; the owner must still verify an email OTP before claiming.
  const created = await provisioning.auth.admin.createUser({ id: userId, email, email_confirm: true })
  // A retry/concurrent request may find that our exact account already exists. Never look up by email.
  const result = created.error ? await provisioning.auth.admin.getUserById(userId) : created
  const user = result.data.user
  return Boolean(
    !result.error &&
    user?.id === userId &&
    user.email?.toLowerCase() === email.toLowerCase() &&
    user.email_confirmed_at &&
    !user.is_anonymous &&
    (!user.banned_until || Date.parse(user.banned_until) <= Date.now())
  )
}
