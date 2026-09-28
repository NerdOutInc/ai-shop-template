import "server-only"

import { isAuthRetryableFetchError } from "@supabase/supabase-js"
import { z } from "zod"

import { env } from "@/lib/env"
import { createAdminServerClient } from "./create-admin-server-client.server"
import { getAdminAuthConfig } from "./get-admin-auth-config.server"

/** Asset reads check current membership, user and session together in the asset query. */
export async function getAdminAssetActor(): Promise<{ userId: string; sessionId: string } | null> {
  if (!env.ADMIN_LIBRARY_ENABLED || !getAdminAuthConfig()) return null
  const client = await createAdminServerClient()
  const { data, error } = await client.auth.getClaims()
  if (error && (isAuthRetryableFetchError(error) || (error.status ?? 0) >= 500)) throw error
  if (error || !data) return null
  const claims = z
    .object({ sub: z.uuid(), session_id: z.uuid(), role: z.literal("authenticated") })
    .safeParse(data.claims)
  return claims.success ? { userId: claims.data.sub, sessionId: claims.data.session_id } : null
}
