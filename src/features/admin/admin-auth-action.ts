"use server"

import { createHash, timingSafeEqual } from "node:crypto"
import { createClient } from "@supabase/supabase-js"
import { z } from "zod"
import { env } from "@/lib/env"
import { AdminStore } from "./admin-store.server"
import { createAdminServerClient } from "./create-admin-server-client.server"
import { getAdminActor } from "./get-admin-actor.server"
import { getAdminAuthConfig } from "./get-admin-auth-config.server"
import { getAdminAuthSource } from "./get-admin-auth-source.server"
import { getAdminDatabase } from "./get-admin-database.server"

export type AdminAuthResult = { ok: boolean; message: string; destination?: string }

const email = z
  .email()
  .max(254)
  .transform((value) => value.toLowerCase())
const token = z.string().regex(/^\d{6,10}$/)
const proof = z.string().min(32).max(256)
const schema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("request-email"), email }),
  z.object({ operation: z.literal("verify-email"), email, token }),
  z.object({ operation: z.literal("request-setup"), email, proof }),
  z.object({ operation: z.literal("verify-setup"), email, token, proof }),
  z.object({ operation: z.literal("finish-passkey") }),
  z.object({ operation: z.literal("sign-out") }),
])

function validOwnerProof(candidateEmail: string, candidate: string) {
  if (!env.ADMIN_OWNER_EMAIL || !env.ADMIN_SETUP_SECRET) return false
  const hash = (value: string) => createHash("sha256").update(value).digest()
  return (
    candidateEmail === env.ADMIN_OWNER_EMAIL.toLowerCase() &&
    timingSafeEqual(hash(candidate), hash(env.ADMIN_SETUP_SECRET))
  )
}

export async function adminAuthAction(input: unknown): Promise<AdminAuthResult> {
  const parsed = schema.safeParse(input)
  const config = getAdminAuthConfig()
  if (!parsed.success || !config)
    return { ok: false, message: "Admin sign-in is unavailable. Check the form or contact the store owner." }
  const command = parsed.data
  try {
    const client = await createAdminServerClient()
    if (command.operation === "sign-out") {
      const { error } = await client.auth.signOut({ scope: "local" })
      return error
        ? { ok: false, message: "Could not sign out. Please try again." }
        : { ok: true, message: "Signed out.", destination: "/admin/sign-in" }
    }
    const store = new AdminStore(getAdminDatabase())
    const isSetup = command.operation === "request-setup" || command.operation === "verify-setup"
    const source = command.operation === "finish-passkey" ? null : await getAdminAuthSource()
    if (command.operation !== "finish-passkey" && !source)
      return { ok: false, message: "Admin sign-in is unavailable. Contact the deployment owner." }
    if (
      isSetup &&
      (!(await store.allowAuthAttempt(`setup:${source}`)) ||
        !validOwnerProof(command.email, command.proof) ||
        (await store.setupStatus()) !== "available")
    )
      return {
        ok: false,
        message: "Owner setup could not be verified. Check your setup details or use owner recovery.",
      }

    if (command.operation === "request-email" || command.operation === "request-setup") {
      if (!(await store.allowAuthAttempt(`send:${source}`)))
        return { ok: false, message: "Too many code requests. Try again in 15 minutes." }
      if (command.operation === "request-setup") {
        if (!env.SUPABASE_SECRET_KEY)
          return { ok: false, message: "Owner setup is not configured. Contact the deployment owner." }
        const provisioning = createClient(config.url, env.SUPABASE_SECRET_KEY, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        })
        // Invitations verify a new owner's email even when public signups are disabled.
        // A normal OTP request treats an unconfirmed account as a blocked signup.
        const { error } = await provisioning.auth.admin.inviteUserByEmail(command.email)
        if (!error) return { ok: true, message: "Your owner verification code is on its way. Check your inbox." }
        if (error && error.code !== "email_exists" && error.code !== "user_already_exists")
          return {
            ok: false,
            message: "Could not prepare owner sign-in. Check the Supabase authentication configuration.",
          }
      }
      const { error } = await client.auth.signInWithOtp({ email: command.email, options: { shouldCreateUser: false } })
      // Ordinary login does not reveal whether a supplied address has an account.
      if (error && command.operation === "request-setup")
        return { ok: false, message: "Could not send the setup code. Check email delivery and the OTP email template." }
      return {
        ok: true,
        message: "If this email has an invited account, a sign-in code is on its way. Check your inbox.",
      }
    }

    if (command.operation === "verify-email" || command.operation === "verify-setup") {
      // Bound source-wide fanout before creating any source/email-specific row.
      if (
        !(await store.allowAuthAttempt(`verify-source:${source}`, 20)) ||
        !(await store.allowAuthAttempt(`verify:${source}:${command.email}`))
      )
        return { ok: false, message: "Too many verification attempts. Try again in 15 minutes." }
      const { data, error } = await client.auth.verifyOtp({ email: command.email, token: command.token, type: "email" })
      if (error || !data.user)
        return { ok: false, message: "That code could not be verified. Request a new code and try again." }
      if (command.operation === "verify-setup") {
        // Use the Auth service's verified user, never a client-supplied UUID or email claim.
        const { data: current, error: currentError } = await client.auth.getUser()
        const ownerEmail = env.ADMIN_OWNER_EMAIL
        if (
          currentError ||
          !current.user?.email_confirmed_at ||
          current.user.is_anonymous ||
          !ownerEmail ||
          current.user.email?.toLowerCase() !== ownerEmail.toLowerCase()
        ) {
          await client.auth.signOut({ scope: "local" })
          return { ok: false, message: "The verified account does not match the configured owner." }
        }
        const claimed = await store.claimOwner(current.user.id, ownerEmail)
        if (!claimed && !(await store.isActiveMember(current.user.id))) {
          await client.auth.signOut({ scope: "local" })
          return {
            ok: false,
            message: "Owner setup is already complete. Use sign-in or ask the dashboard owner to restore access.",
          }
        }
        return {
          ok: true,
          message: "Owner setup complete. Welcome to the other side of the wall.",
          destination: "/admin/account",
        }
      }
    }

    const actor = await getAdminActor()
    if (!actor) {
      await client.auth.signOut({ scope: "local" })
      return {
        ok: false,
        message: "This account has no active administrator membership. Ask the store owner to grant access.",
      }
    }
    return { ok: true, message: "Signed in.", destination: "/admin/concepts" }
  } catch {
    return {
      ok: false,
      message: "Admin sign-in is temporarily unavailable. Please try again or contact the store owner.",
    }
  }
}
