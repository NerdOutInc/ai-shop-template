import "server-only"

import { createClient, type AuthError } from "@supabase/supabase-js"
import { env } from "@/lib/env"
import type { AdminStore } from "./admin-store.server"
import { getAdminAuthConfig } from "./get-admin-auth-config.server"
import type { OwnerSetupFailureReason } from "./owner-setup-failure.server"

type OwnerPreparationResult = { ok: true } | { ok: false; reason: OwnerSetupFailureReason }

function providerFailure(error: AuthError): OwnerPreparationResult {
  return {
    ok: false,
    reason: error.status === 401 || error.status === 403 ? "provider-credentials" : "provider-unavailable",
  }
}

export async function prepareAdminOwner(store: AdminStore, email: string): Promise<OwnerPreparationResult> {
  const config = getAdminAuthConfig()
  if (!config || !env.SUPABASE_SECRET_KEY) return { ok: false, reason: "unconfigured" }
  const userId = await store.reserveOwner(email)
  if (!userId) return { ok: false, reason: "setup-changed" }
  try {
    const provisioning = createClient(config.url, env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    // Only the Admin API can choose this reserved ID. Existing emails are rejected, not updated.
    // Confirm at creation so signInWithOtp can send a code while public signup is disabled.
    // This provider flag grants no membership: the owner must still verify the mailbox OTP.
    const created = await provisioning.auth.admin.createUser({ id: userId, email, email_confirm: true })
    if (created.error?.status === 401 || created.error?.status === 403) return providerFailure(created.error)
    // A retry/concurrent request may find our exact account already exists. Never look up by email.
    const result = created.error ? await provisioning.auth.admin.getUserById(userId) : created
    if (result.error) {
      const duplicate = created.error?.code === "email_exists" || created.error?.code === "user_already_exists"
      const missing = result.error.status === 404 || result.error.code === "user_not_found"
      return duplicate && missing ? { ok: false, reason: "account-conflict" } : providerFailure(result.error)
    }
    const user = result.data.user
    if (
      !user ||
      user.id !== userId ||
      user.email?.toLowerCase() !== email.toLowerCase() ||
      !user.email_confirmed_at ||
      user.is_anonymous ||
      (user.banned_until && !(Date.parse(user.banned_until) <= Date.now()))
    )
      return { ok: false, reason: "account-mismatch" }
    return { ok: true }
  } catch {
    // Transport exceptions may contain URLs, keys or provider payloads. Return only a fixed reason.
    return { ok: false, reason: "provider-unavailable" }
  }
}
